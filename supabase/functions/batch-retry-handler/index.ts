import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

enum ErrorType {
  TIMEOUT = 'timeout',
  API_LIMIT = 'api_limit',
  MEMORY_LIMIT = 'memory_limit',
  NETWORK_ERROR = 'network_error',
  DATA_ERROR = 'data_error',
  UNKNOWN = 'unknown'
}

interface RetryConfig {
  maxRetries: number
  baseDelay: number        // 基础延迟（毫秒）
  maxDelay: number         // 最大延迟（毫秒）
  exponentialFactor: number // 指数因子
  jitterEnabled: boolean   // 是否启用抖动
}

interface FailedTask {
  id: string
  report_id: string
  batch_id: string
  retry_count: number
  max_retries: number
  error_details: any
  last_error: string
  failed_at: string
}

interface RetryRequest {
  taskId?: string          // 重试特定任务
  reportId?: string        // 重试报告的所有失败任务
  batchId?: string         // 重试批次的所有失败任务
  errorType?: ErrorType    // 重试特定错误类型的任务
  forceRetry?: boolean     // 强制重试（即使超过最大重试次数）
  customConfig?: Partial<RetryConfig>
}

// 默认重试配置
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 2000,         // 2秒
  maxDelay: 300000,        // 5分钟
  exponentialFactor: 2,
  jitterEnabled: true
}

// 针对不同错误类型的重试配置
const ERROR_TYPE_CONFIGS: Record<ErrorType, Partial<RetryConfig>> = {
  [ErrorType.TIMEOUT]: {
    maxRetries: 2,
    baseDelay: 5000,       // 超时错误延迟更长
    exponentialFactor: 1.5
  },
  [ErrorType.API_LIMIT]: {
    maxRetries: 5,
    baseDelay: 60000,      // API限制延迟1分钟
    exponentialFactor: 1.2
  },
  [ErrorType.MEMORY_LIMIT]: {
    maxRetries: 1,         // 内存限制重试次数少
    baseDelay: 10000,
    exponentialFactor: 2
  },
  [ErrorType.NETWORK_ERROR]: {
    maxRetries: 4,
    baseDelay: 1000,
    exponentialFactor: 2
  },
  [ErrorType.DATA_ERROR]: {
    maxRetries: 1,         // 数据错误通常无法通过重试解决
    baseDelay: 5000,
    exponentialFactor: 1
  },
  [ErrorType.UNKNOWN]: {
    maxRetries: 2,
    baseDelay: 3000,
    exponentialFactor: 1.5
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { 
      taskId, 
      reportId, 
      batchId, 
      errorType, 
      forceRetry, 
      customConfig 
    }: RetryRequest = await req.json()

    console.log('🔄 Batch Retry Handler: Processing retry request...')

    let failedTasks: FailedTask[] = []

    // 查找需要重试的任务
    if (taskId) {
      // 重试特定任务
      const { data: task, error } = await supabaseClient
        .from('processing_queue')
        .select('*')
        .eq('id', taskId)
        .eq('status', 'failed')
        .single()

      if (error || !task) {
        return new Response(
          JSON.stringify({ error: 'Failed task not found' }),
          { 
            status: 404, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        )
      }

      failedTasks = [task]
    } else {
      // 构建查询条件
      let query = supabaseClient
        .from('processing_queue')
        .select('*')
        .eq('status', 'failed')

      if (reportId) query = query.eq('report_id', reportId)
      if (batchId) query = query.eq('batch_id', batchId)
      
      if (!forceRetry) {
        query = query.lt('retry_count', supabaseClient.raw('max_retries'))
      }

      const { data: tasks, error } = await query
        .order('priority', { ascending: false })
        .limit(50) // 限制批量处理数量

      if (error) {
        throw new Error(`Failed to fetch failed tasks: ${error.message}`)
      }

      failedTasks = tasks || []

      // 按错误类型过滤
      if (errorType) {
        failedTasks = failedTasks.filter(task => 
          classifyError(task.error_details) === errorType
        )
      }
    }

    if (failedTasks.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No eligible failed tasks found for retry',
          retriedTasks: 0
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log(`🚀 Found ${failedTasks.length} failed tasks to retry`)

    const retryResults = []

    // 处理每个失败的任务
    for (const task of failedTasks) {
      try {
        const errorType = classifyError(task.error_details)
        const retryConfig = getRetryConfig(errorType, customConfig)
        
        // 检查是否可以重试
        if (!forceRetry && task.retry_count >= task.max_retries) {
          console.log(`⏭️ Task ${task.id} has exceeded max retries, skipping`)
          continue
        }

        // 计算延迟时间
        const delay = calculateDelay(task.retry_count, retryConfig)
        
        console.log(`⏰ Scheduling retry for task ${task.id} with ${delay}ms delay`)

        // 调度重试（立即更新状态，延迟执行）
        const retryResult = await scheduleRetry(task, delay, supabaseClient)
        retryResults.push(retryResult)

      } catch (error) {
        console.error(`❌ Failed to schedule retry for task ${task.id}:`, error)
        retryResults.push({
          taskId: task.id,
          success: false,
          error: error.message
        })
      }
    }

    // 记录重试统计
    await logRetryMetrics(failedTasks.length, retryResults, supabaseClient)

    const successfulRetries = retryResults.filter(r => r.success).length

    return new Response(
      JSON.stringify({
        success: true,
        message: `Scheduled ${successfulRetries} task retries`,
        totalTasks: failedTasks.length,
        scheduledRetries: successfulRetries,
        retryResults: retryResults,
        timestamp: new Date().toISOString()
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Error in batch-retry-handler:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Retry scheduling failed',
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

// 分类错误类型
function classifyError(errorDetails: any): ErrorType {
  if (!errorDetails) return ErrorType.UNKNOWN

  const errorString = JSON.stringify(errorDetails).toLowerCase()

  if (errorString.includes('timeout') || errorString.includes('time out')) {
    return ErrorType.TIMEOUT
  }
  if (errorString.includes('rate limit') || errorString.includes('api limit')) {
    return ErrorType.API_LIMIT
  }
  if (errorString.includes('memory') || errorString.includes('heap')) {
    return ErrorType.MEMORY_LIMIT
  }
  if (errorString.includes('network') || errorString.includes('connection')) {
    return ErrorType.NETWORK_ERROR
  }
  if (errorString.includes('invalid data') || errorString.includes('parse error')) {
    return ErrorType.DATA_ERROR
  }

  return ErrorType.UNKNOWN
}

// 获取重试配置
function getRetryConfig(errorType: ErrorType, customConfig?: Partial<RetryConfig>): RetryConfig {
  const baseConfig = { ...DEFAULT_RETRY_CONFIG }
  const errorConfig = ERROR_TYPE_CONFIGS[errorType] || {}
  const finalConfig = { ...baseConfig, ...errorConfig, ...customConfig }
  return finalConfig
}

// 计算延迟时间（指数退避 + 抖动）
function calculateDelay(retryCount: number, config: RetryConfig): number {
  let delay = config.baseDelay * Math.pow(config.exponentialFactor, retryCount)
  
  // 限制最大延迟
  delay = Math.min(delay, config.maxDelay)
  
  // 添加抖动以避免雷群效应
  if (config.jitterEnabled) {
    const jitter = delay * 0.1 * Math.random() // 10%的随机抖动
    delay += jitter
  }
  
  return Math.round(delay)
}

// 调度重试
async function scheduleRetry(
  task: FailedTask,
  delay: number,
  supabaseClient: any
): Promise<any> {
  
  // 更新任务状态为排队，增加重试计数
  const { error: updateError } = await supabaseClient
    .from('processing_queue')
    .update({
      status: 'queued',
      retry_count: task.retry_count + 1,
      scheduled_at: new Date(Date.now() + delay).toISOString(),
      error_details: null // 清除之前的错误
    })
    .eq('id', task.id)

  if (updateError) {
    throw new Error(`Failed to update task status: ${updateError.message}`)
  }

  // 延迟后调用实际处理函数
  setTimeout(async () => {
    try {
      console.log(`🚀 Executing delayed retry for task ${task.id}`)
      
      // 调用process-analysis-batch-v2进行实际处理
      const response = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/process-analysis-batch-v2`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`
        },
        body: JSON.stringify({
          queueId: task.id,
          forceRetry: true
        })
      })

      if (!response.ok) {
        throw new Error(`Process batch failed: ${response.statusText}`)
      }

      console.log(`✅ Successfully triggered retry for task ${task.id}`)
    } catch (error) {
      console.error(`❌ Retry execution failed for task ${task.id}:`, error)
      
      // 标记为永久失败
      await supabaseClient
        .from('processing_queue')
        .update({
          status: 'failed',
          error_details: { 
            ...task.error_details, 
            retry_failed: true, 
            retry_error: error.message 
          }
        })
        .eq('id', task.id)
    }
  }, delay)

  return {
    taskId: task.id,
    success: true,
    delay: delay,
    scheduledAt: new Date(Date.now() + delay).toISOString()
  }
}

// 记录重试指标
async function logRetryMetrics(
  totalTasks: number,
  retryResults: any[],
  supabaseClient: any
): Promise<void> {
  try {
    const successfulRetries = retryResults.filter(r => r.success).length
    const failedRetries = retryResults.filter(r => !r.success).length

    // 记录系统指标
    await supabaseClient
      .from('system_metrics')
      .insert([
        {
          metric_name: 'retry_tasks_total',
          metric_value: totalTasks,
          metric_unit: 'count',
          tags: { component: 'batch-retry-handler' }
        },
        {
          metric_name: 'retry_tasks_successful',
          metric_value: successfulRetries,
          metric_unit: 'count',
          tags: { component: 'batch-retry-handler' }
        },
        {
          metric_name: 'retry_tasks_failed',
          metric_value: failedRetries,
          metric_unit: 'count',
          tags: { component: 'batch-retry-handler' }
        }
      ])

    console.log(`📊 Logged retry metrics: ${successfulRetries}/${totalTasks} successful`)
  } catch (error) {
    console.error('Failed to log retry metrics:', error)
  }
} 