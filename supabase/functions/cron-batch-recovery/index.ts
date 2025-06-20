import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

interface RecoveryResult {
  checked_reports: number;
  recovered_batches: number;
  failed_reports: number;
  execution_time: number;
}

const MAX_BATCH_AGE_MINUTES = 20; // 批次最大处理时间
const REPORT_TIMEOUT_MINUTES = 60; // 报告超时时间

Deno.serve(async (req: Request) => {
  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('🔧 批次恢复任务开始执行...');

    const result: RecoveryResult = {
      checked_reports: 0,
      recovered_batches: 0,
      failed_reports: 0,
      execution_time: 0
    };

    // 1. 查找处于分析状态但可能卡住的报告
    const { data: stuckReports, error: reportsError } = await supabase
      .from('reports')
      .select(`
        id,
        status,
        analysis_started_at,
        updated_at,
        analysis_tasks (
          id,
          batch_id,
          status,
          created_at,
          completed_at
        )
      `)
      .eq('status', 'analyzing')
      .lt('analysis_started_at', new Date(Date.now() - REPORT_TIMEOUT_MINUTES * 60 * 1000).toISOString());

    if (reportsError) {
      throw new Error(`查询卡住的报告失败: ${reportsError.message}`);
    }

    result.checked_reports = stuckReports?.length || 0;

    if (!stuckReports || stuckReports.length === 0) {
      console.log('✅ 没有发现卡住的报告');
      result.execution_time = Date.now() - startTime;
      
      return new Response(JSON.stringify({
        success: true,
        message: '批次恢复检查完成，无需恢复',
        result: result
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 2. 分析每个卡住的报告
    for (const report of stuckReports) {
      console.log(`🔍 检查报告 ${report.id} 的分析状态...`);

      const tasks = report.analysis_tasks || [];
      const completedTasks = tasks.filter((t: any) => t.status === 'completed');
      const processingTasks = tasks.filter((t: any) => t.status === 'processing');
      const failedTasks = tasks.filter((t: any) => t.status === 'failed');

      console.log(`报告 ${report.id}: 总任务 ${tasks.length}, 已完成 ${completedTasks.length}, 处理中 ${processingTasks.length}, 失败 ${failedTasks.length}`);

      // 3. 检查是否有长时间处理中的任务
      const stuckProcessingTasks = processingTasks.filter((t: any) => {
        const createdTime = new Date(t.created_at).getTime();
        return Date.now() - createdTime > MAX_BATCH_AGE_MINUTES * 60 * 1000;
      });

      if (stuckProcessingTasks.length > 0) {
        console.log(`🔧 发现 ${stuckProcessingTasks.length} 个卡住的处理任务，准备恢复...`);

        // 重置卡住的任务到队列中
        for (const task of stuckProcessingTasks) {
          const { error: resetError } = await supabase
            .from('processing_queue')
            .upsert({
              report_id: report.id,
              batch_id: task.batch_id,
              status: 'queued',
              priority: 8, // 高优先级恢复
              retry_count: 0,
              max_retries: 2,
              scheduled_at: new Date().toISOString(),
              error_details: {
                recovery_reason: '批次恢复任务重置',
                original_task_id: task.id,
                recovery_timestamp: new Date().toISOString()
              }
            });

          if (!resetError) {
            // 同时更新原任务状态
            await supabase
              .from('analysis_tasks')
              .update({
                status: 'queued',
                updated_at: new Date().toISOString()
              })
              .eq('id', task.id);

            result.recovered_batches++;
            console.log(`✅ 任务 ${task.id} 已重置到队列`);
          }
        }
      }

      // 4. 检查是否所有任务都已完成或失败
      if (tasks.length > 0 && (completedTasks.length + failedTasks.length) === tasks.length) {
        if (failedTasks.length === tasks.length) {
          // 所有任务都失败了
          await supabase
            .from('reports')
            .update({
              status: 'failed',
              error_details: {
                failure_reason: '所有分析任务失败',
                failed_tasks: failedTasks.length,
                recovery_timestamp: new Date().toISOString()
              },
              updated_at: new Date().toISOString()
            })
            .eq('id', report.id);

          result.failed_reports++;
          console.log(`❌ 报告 ${report.id} 标记为失败（所有任务失败）`);
        } else if (completedTasks.length > 0) {
          // 有一些任务完成了，尝试触发报告完成
          try {
            const completeResponse = await fetch(`${supabaseUrl}/functions/v1/complete-report-analysis`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                reportId: report.id,
                recovery_mode: true
              })
            });

            if (completeResponse.ok) {
              console.log(`✅ 报告 ${report.id} 恢复完成处理已触发`);
            } else {
              console.log(`⚠️ 报告 ${report.id} 完成处理触发失败`);
            }
          } catch (error) {
            console.error(`报告 ${report.id} 完成处理异常:`, error);
          }
        }
      }
    }

    // 5. 清理过期的队列任务
    const { error: cleanupError } = await supabase
      .from('processing_queue')
      .delete()
      .eq('status', 'failed')
      .lt('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()); // 清理24小时前的失败任务

    if (cleanupError) {
      console.error('清理过期任务失败:', cleanupError);
    } else {
      console.log('✅ 过期失败任务清理完成');
    }

    result.execution_time = Date.now() - startTime;
    console.log('📊 批次恢复执行完成:', result);

    // 记录执行日志
    try {
      await supabase
        .from('cron_execution_log')
        .insert({
          function_name: 'cron-batch-recovery',
          execution_time: result.execution_time,
          result: result,
          executed_at: new Date().toISOString()
        });
    } catch (logError) {
      console.log('恢复日志记录失败:', logError);
    }

    return new Response(JSON.stringify({
      success: true,
      message: '批次恢复任务执行完成',
      result: result
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('❌ 批次恢复执行失败:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}); 