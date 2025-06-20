import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

interface AnalysisTask {
  id: string;
  report_id: string;
  batch_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  started_at: string | null;
  created_at: string;
  retry_count: number;
  max_retries: number;
}

interface MonitoringResult {
  checked_tasks: number;
  recovered_tasks: number;
  failed_tasks: number;
  alerts_sent: number;
  execution_time: number;
}

const TIMEOUT_THRESHOLD_MINUTES = 10; // Edge Function超时阈值
const STALE_TASK_THRESHOLD_MINUTES = 30; // 任务过期阈值

Deno.serve(async (req: Request) => {
  const startTime = Date.now();
  
  try {
    // 初始化Supabase客户端
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('🔄 Cron监控开始执行...');

    const result: MonitoringResult = {
      checked_tasks: 0,
      recovered_tasks: 0,
      failed_tasks: 0,
      alerts_sent: 0,
      execution_time: 0
    };

    // 1. 检查超时的processing任务
    const { data: timeoutTasks, error: timeoutError } = await supabase
      .from('processing_queue')
      .select('*')
      .eq('status', 'processing')
      .lt('started_at', new Date(Date.now() - TIMEOUT_THRESHOLD_MINUTES * 60 * 1000).toISOString());

    if (timeoutError) {
      throw new Error(`查询超时任务失败: ${timeoutError.message}`);
    }

    result.checked_tasks += timeoutTasks?.length || 0;

    // 2. 恢复超时任务
    for (const task of timeoutTasks || []) {
      if (task.retry_count < task.max_retries) {
        // 重置任务状态，准备重试
        const { error: resetError } = await supabase
          .from('processing_queue')
          .update({
            status: 'queued',
            retry_count: task.retry_count + 1,
            started_at: null,
            scheduled_at: new Date().toISOString(),
            error_details: {
              ...task.error_details,
              last_timeout: new Date().toISOString(),
              timeout_reason: 'Edge Function超时恢复'
            }
          })
          .eq('id', task.id);

        if (!resetError) {
          result.recovered_tasks++;
          console.log(`✅ 任务 ${task.id} 已重置，准备重试 (第${task.retry_count + 1}次)`);
        }
      } else {
        // 超过最大重试次数，标记为失败
        const { error: failError } = await supabase
          .from('processing_queue')
          .update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_details: {
              ...task.error_details,
              final_failure: new Date().toISOString(),
              failure_reason: '超过最大重试次数'
            }
          })
          .eq('id', task.id);

        if (!failError) {
          result.failed_tasks++;
          console.log(`❌ 任务 ${task.id} 最终失败，已标记为failed状态`);
        }
      }
    }

    // 3. 检查长时间排队的任务
    const { data: staleTasks, error: staleError } = await supabase
      .from('processing_queue')
      .select('*')
      .eq('status', 'queued')
      .lt('created_at', new Date(Date.now() - STALE_TASK_THRESHOLD_MINUTES * 60 * 1000).toISOString());

    if (staleError) {
      console.error(`查询过期任务失败: ${staleError.message}`);
    } else if (staleTasks && staleTasks.length > 0) {
      console.log(`⚠️ 发现 ${staleTasks.length} 个长时间排队的任务`);
      
      // 发送告警（调用alert-manager函数）
      try {
        const alertResponse = await fetch(`${supabaseUrl}/functions/v1/alert-manager`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            type: 'stale_tasks',
            message: `发现 ${staleTasks.length} 个长时间排队的任务`,
            severity: 'warning',
            tasks: staleTasks.map(t => ({ id: t.id, report_id: t.report_id, age_minutes: Math.floor((Date.now() - new Date(t.created_at).getTime()) / 60000) }))
          })
        });

        if (alertResponse.ok) {
          result.alerts_sent++;
        }
      } catch (alertError) {
        console.error('发送告警失败:', alertError);
      }
    }

    // 4. 触发排队任务的处理
    const { data: queuedTasks, error: queuedError } = await supabase
      .from('processing_queue')
      .select('*')
      .eq('status', 'queued')
      .order('priority', { ascending: false })
      .order('scheduled_at', { ascending: true })
      .limit(4); // 最多同时处理4个批次

    if (!queuedError && queuedTasks && queuedTasks.length > 0) {
      console.log(`🚀 发现 ${queuedTasks.length} 个排队任务，准备触发处理`);
      
      // 并行触发处理
      const processingPromises = queuedTasks.map(async (task) => {
        try {
          const response = await fetch(`${supabaseUrl}/functions/v1/process-analysis-batch`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              report_id: task.report_id,
              batch_id: task.batch_id,
              queue_task_id: task.id
            })
          });

          if (response.ok) {
            console.log(`✅ 任务 ${task.id} 处理已触发`);
          } else {
            console.error(`❌ 任务 ${task.id} 触发失败:`, await response.text());
          }
        } catch (error) {
          console.error(`任务 ${task.id} 触发异常:`, error);
        }
      });

      await Promise.allSettled(processingPromises);
    }

    // 5. 记录监控结果
    result.execution_time = Date.now() - startTime;
    
    console.log('📊 监控执行完成:', result);

    // 记录到数据库（如果有监控日志表）
    try {
      await supabase
        .from('cron_execution_log')
        .insert({
          function_name: 'cron-analysis-monitor',
          execution_time: result.execution_time,
          result: result,
          executed_at: new Date().toISOString()
        });
    } catch (logError) {
      // 忽略日志记录错误，不影响主要功能
      console.log('监控日志记录失败:', logError);
    }

    return new Response(JSON.stringify({
      success: true,
      message: '分析监控执行完成',
      result: result
    }), {
      headers: {
        'Content-Type': 'application/json'
      }
    });

  } catch (error: any) {
    console.error('❌ Cron监控执行失败:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }
}); 