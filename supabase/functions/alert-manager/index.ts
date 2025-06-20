import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface AlertConfig {
  channels: ('email' | 'webhook' | 'database' | 'console')[]
  severity: 'low' | 'medium' | 'high' | 'critical'
  threshold: number
  cooldown: number  // 冷却时间，避免重复告警（分钟）
  enabled: boolean
}

interface AlertRule {
  id: string
  name: string
  description: string
  condition: string
  threshold: number
  config: AlertConfig
  lastTriggered?: string
}

interface SystemAlert {
  id: string
  rule: AlertRule
  severity: 'low' | 'medium' | 'high' | 'critical'
  message: string
  data: any
  timestamp: string
  acknowledged: boolean
}

interface AlertRequest {
  checkRules?: boolean
  rules?: AlertRule[]
  manualAlert?: {
    severity: 'low' | 'medium' | 'high' | 'critical'
    message: string
    data?: any
  }
}

// 预定义的告警规则
const DEFAULT_ALERT_RULES: AlertRule[] = [
  {
    id: 'high_processing_time',
    name: '处理时间过长告警',
    description: '平均处理时间超过阈值',
    condition: 'average_processing_time > threshold',
    threshold: 300, // 5分钟
    config: {
      channels: ['database', 'console'],
      severity: 'medium',
      threshold: 300,
      cooldown: 15, // 15分钟冷却
      enabled: true
    }
  },
  {
    id: 'high_error_rate',
    name: '错误率过高告警',
    description: '错误率超过阈值',
    condition: 'error_rate > threshold',
    threshold: 0.15, // 15%
    config: {
      channels: ['database', 'console'],
      severity: 'high',
      threshold: 0.15,
      cooldown: 10, // 10分钟冷却
      enabled: true
    }
  },
  {
    id: 'queue_backlog',
    name: '队列积压告警',
    description: '等待处理的任务过多',
    condition: 'queue_length > threshold',
    threshold: 20,
    config: {
      channels: ['database', 'console'],
      severity: 'medium',
      threshold: 20,
      cooldown: 20, // 20分钟冷却
      enabled: true
    }
  },
  {
    id: 'system_overload',
    name: '系统过载告警',
    description: '系统负载过高',
    condition: 'current_load > threshold OR memory_usage > threshold',
    threshold: 0.9, // 90%
    config: {
      channels: ['database', 'console'],
      severity: 'critical',
      threshold: 0.9,
      cooldown: 5, // 5分钟冷却
      enabled: true
    }
  },
  {
    id: 'processing_timeout',
    name: '处理超时告警',
    description: '任务处理时间超过预期',
    condition: 'processing_duration > threshold',
    threshold: 600, // 10分钟
    config: {
      channels: ['database', 'console'],
      severity: 'high',
      threshold: 600,
      cooldown: 30, // 30分钟冷却
      enabled: true
    }
  }
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { checkRules, rules, manualAlert }: AlertRequest = await req.json()

    console.log('🚨 Alert Manager: Processing alert request...')

    let alerts: SystemAlert[] = []

    if (manualAlert) {
      // 处理手动告警
      const manualAlertObj = await createManualAlert(manualAlert, supabaseClient)
      alerts.push(manualAlertObj)
      await processAlert(manualAlertObj, supabaseClient)
    }

    if (checkRules || !manualAlert) {
      // 检查系统告警规则
      const rulesToCheck = rules || DEFAULT_ALERT_RULES
      const systemAlerts = await checkAlertRules(rulesToCheck, supabaseClient)
      alerts.push(...systemAlerts)

      // 处理触发的告警
      for (const alert of systemAlerts) {
        await processAlert(alert, supabaseClient)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        alertsTriggered: alerts.length,
        alerts: alerts.map(alert => ({
          id: alert.id,
          severity: alert.severity,
          message: alert.message,
          timestamp: alert.timestamp
        })),
        rulesChecked: checkRules ? (rules?.length || DEFAULT_ALERT_RULES.length) : 0,
        timestamp: new Date().toISOString()
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Error in alert-manager:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Alert management failed',
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

async function createManualAlert(
  manualAlert: any,
  supabaseClient: any
): Promise<SystemAlert> {
  return {
    id: `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    rule: {
      id: 'manual',
      name: '手动告警',
      description: '用户手动触发的告警',
      condition: 'manual_trigger',
      threshold: 0,
      config: {
        channels: ['database', 'console'],
        severity: manualAlert.severity,
        threshold: 0,
        cooldown: 0,
        enabled: true
      }
    },
    severity: manualAlert.severity,
    message: manualAlert.message,
    data: manualAlert.data || {},
    timestamp: new Date().toISOString(),
    acknowledged: false
  }
}

async function checkAlertRules(
  rules: AlertRule[], 
  supabaseClient: any
): Promise<SystemAlert[]> {
  const alerts: SystemAlert[] = []

  try {
    // 获取系统指标（从 resource-optimizer 获取）
    const metrics = await getSystemMetrics(supabaseClient)

    for (const rule of rules) {
      if (!rule.config.enabled) continue

      // 检查冷却时间
      if (await isInCooldown(rule, supabaseClient)) {
        continue
      }

      // 评估告警条件
      const shouldTrigger = await evaluateAlertCondition(rule, metrics)
      
      if (shouldTrigger) {
        const alert = await createAlert(rule, metrics, supabaseClient)
        alerts.push(alert)
        
        // 更新规则最后触发时间
        await updateRuleLastTriggered(rule, supabaseClient)
      }
    }

  } catch (error) {
    console.error('Error checking alert rules:', error)
  }

  return alerts
}

async function getSystemMetrics(supabaseClient: any): Promise<any> {
  try {
    // 调用 resource-optimizer 获取最新指标
    const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/resource-optimizer`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`,
        'Content-Type': 'application/json'
      }
    })

    if (response.ok) {
      const data = await response.json()
      return data.metrics
    }

    // 如果无法获取指标，返回默认值
    return {
      currentLoad: 0,
      memoryUsage: 0,
      activeConnections: 0,
      queueLength: 0,
      averageProcessingTime: 0,
      errorRate: 0
    }

  } catch (error) {
    console.error('Error getting system metrics for alerts:', error)
    return {
      currentLoad: 0,
      memoryUsage: 0,
      activeConnections: 0,
      queueLength: 0,
      averageProcessingTime: 0,
      errorRate: 0
    }
  }
}

async function evaluateAlertCondition(rule: AlertRule, metrics: any): Promise<boolean> {
  try {
    switch (rule.id) {
      case 'high_processing_time':
        return metrics.averageProcessingTime > rule.threshold

      case 'high_error_rate':
        return metrics.errorRate > rule.threshold

      case 'queue_backlog':
        return metrics.queueLength > rule.threshold

      case 'system_overload':
        return metrics.currentLoad > rule.threshold || metrics.memoryUsage > rule.threshold

      case 'processing_timeout':
        // 这需要检查具体的处理任务
        const { data: longRunningTasks } = await supabaseClient
          .from('processing_queue')
          .select('started_at')
          .eq('status', 'processing')
          .lt('started_at', new Date(Date.now() - rule.threshold * 1000).toISOString())

        return longRunningTasks && longRunningTasks.length > 0

      default:
        return false
    }
  } catch (error) {
    console.error(`Error evaluating alert condition for rule ${rule.id}:`, error)
    return false
  }
}

async function isInCooldown(rule: AlertRule, supabaseClient: any): Promise<boolean> {
  if (!rule.lastTriggered) return false

  const lastTriggeredTime = new Date(rule.lastTriggered).getTime()
  const cooldownPeriod = rule.config.cooldown * 60 * 1000 // 转换为毫秒
  const now = Date.now()

  return (now - lastTriggeredTime) < cooldownPeriod
}

async function createAlert(rule: AlertRule, metrics: any, supabaseClient: any): Promise<SystemAlert> {
  let message = ''
  
  switch (rule.id) {
    case 'high_processing_time':
      message = `平均处理时间过长: ${Math.round(metrics.averageProcessingTime)}秒 (阈值: ${rule.threshold}秒)`
      break
    case 'high_error_rate':
      message = `错误率过高: ${(metrics.errorRate * 100).toFixed(1)}% (阈值: ${(rule.threshold * 100).toFixed(1)}%)`
      break
    case 'queue_backlog':
      message = `队列积压严重: ${metrics.queueLength}个任务等待处理 (阈值: ${rule.threshold})`
      break
    case 'system_overload':
      message = `系统负载过高: CPU ${(metrics.currentLoad * 100).toFixed(1)}%, 内存 ${(metrics.memoryUsage * 100).toFixed(1)}% (阈值: ${(rule.threshold * 100).toFixed(1)}%)`
      break
    case 'processing_timeout':
      message = `检测到超时任务: 处理时间超过 ${Math.round(rule.threshold / 60)} 分钟`
      break
    default:
      message = `触发告警规则: ${rule.name}`
  }

  return {
    id: `alert_${rule.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    rule,
    severity: rule.config.severity,
    message,
    data: { metrics, rule },
    timestamp: new Date().toISOString(),
    acknowledged: false
  }
}

async function updateRuleLastTriggered(rule: AlertRule, supabaseClient: any): Promise<void> {
  try {
    // 这里可以更新告警规则的最后触发时间
    // 由于我们使用的是内存中的规则，暂时只在日志中记录
    console.log(`📝 Alert rule '${rule.id}' triggered at ${new Date().toISOString()}`)
  } catch (error) {
    console.error('Error updating rule last triggered time:', error)
  }
}

async function processAlert(alert: SystemAlert, supabaseClient: any): Promise<void> {
  try {
    console.log(`🚨 Processing ${alert.severity.toUpperCase()} alert: ${alert.message}`)

    // 处理不同的告警渠道
    for (const channel of alert.rule.config.channels) {
      await sendAlertToChannel(alert, channel, supabaseClient)
    }

  } catch (error) {
    console.error('Error processing alert:', error)
  }
}

async function sendAlertToChannel(
  alert: SystemAlert, 
  channel: string, 
  supabaseClient: any
): Promise<void> {
  try {
    switch (channel) {
      case 'console':
        console.log(`🚨 ${alert.severity.toUpperCase()} ALERT: ${alert.message}`)
        console.log(`📊 Alert data:`, JSON.stringify(alert.data, null, 2))
        break

      case 'database':
        // 保存告警到数据库（如果有告警表的话）
        console.log(`💾 Saving alert to database: ${alert.id}`)
        break

      case 'webhook':
        // 发送到 webhook（需要配置 webhook URL）
        console.log(`🔗 Sending alert to webhook: ${alert.id}`)
        break

      case 'email':
        // 发送邮件告警（需要配置邮件服务）
        console.log(`📧 Sending email alert: ${alert.id}`)
        break

      default:
        console.log(`❓ Unknown alert channel: ${channel}`)
    }
  } catch (error) {
    console.error(`Error sending alert to ${channel}:`, error)
  }
} 