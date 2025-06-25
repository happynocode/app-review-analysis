import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

interface BatchProcessorResult {
  checked_reports: number;
  processed_batches: number;
  completed_reports: number;
  execution_time: number;
  errors: string[];
}

const MAX_BATCHES_PER_CALL = 4; // 每次最多处理4个批次

Deno.serve(async (req: Request) => {
  const startTime = Date.now();
  
  try {
    // 初始化Supabase客户端
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('🔄 批次处理器开始执行...');

    const result: BatchProcessorResult = {
      checked_reports: 0,
      processed_batches: 0,
      completed_reports: 0,
      execution_time: 0,
      errors: []
    };

    // 1. 查找正在分析的报告（排除正在完成的报告）
    const { data: analyzingReports, error: reportsError } = await supabase
      .from('reports')
      .select('id, app_name, created_at, status')
      .eq('status', 'analyzing')
      .order('created_at', { ascending: true });

    if (reportsError) {
      throw new Error(`查询分析报告失败: ${reportsError.message}`);
    }

    if (!analyzingReports || analyzingReports.length === 0) {
      console.log('✅ 没有正在分析的报告');
      result.execution_time = Date.now() - startTime;
      return new Response(JSON.stringify({
        success: true,
        message: '没有正在分析的报告',
        result
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    console.log(`🔍 发现 ${analyzingReports.length} 个正在分析的报告`);
    result.checked_reports = analyzingReports.length;

    // 2. 处理每个报告的分析任务
    for (const report of analyzingReports) {
      try {
        console.log(`📊 检查报告 ${report.id} (${report.app_name})`);

        // 首先检查并恢复卡住的processing任务
        await recoverStuckTasks(supabase, report.id);

        // 查找该报告的待处理任务
        const { data: pendingTasks, error: tasksError } = await supabase
          .from('analysis_tasks')
          .select('id, batch_index, analysis_type, status')
          .eq('report_id', report.id)
          .eq('status', 'pending')
          .order('batch_index', { ascending: true })
          .limit(MAX_BATCHES_PER_CALL);

        if (tasksError) {
          result.errors.push(`获取报告 ${report.id} 的分析任务失败: ${tasksError.message}`);
          continue;
        }

        if (pendingTasks && pendingTasks.length > 0) {
          console.log(`🚀 报告 ${report.id} 有 ${pendingTasks.length} 个待处理批次`);

          // 调用process-analysis-batch-v2处理这些任务
          const processed = await processBatches(supabaseUrl, supabaseKey, report.id);
          if (processed) {
            result.processed_batches += pendingTasks.length;
          }
        } else {
          // 没有待处理任务，检查是否所有任务都完成了
          const { data: allTasks, error: allTasksError } = await supabase
            .from('analysis_tasks')
            .select('id, status')
            .eq('report_id', report.id);

          if (allTasksError) {
            result.errors.push(`检查报告 ${report.id} 所有任务状态失败: ${allTasksError.message}`);
            continue;
          }

          if (allTasks && allTasks.length > 0) {
            const completedTasks = allTasks.filter(task => task.status === 'completed');
            const failedTasks = allTasks.filter(task => task.status === 'failed');
            const totalTasks = allTasks.length;

            console.log(`📈 报告 ${report.id} 任务状态: ${completedTasks.length}/${totalTasks} 完成, ${failedTasks.length} 失败`);

            // 如果所有任务都完成或失败，触发报告完成
            if (completedTasks.length + failedTasks.length === totalTasks) {
              console.log(`✅ 报告 ${report.id} 所有分析任务已完成，触发报告生成`);

              // 检查报告状态是否仍然是 analyzing，避免重复处理
              const { data: currentReport, error: statusError } = await supabase
                .from('reports')
                .select('status')
                .eq('id', report.id)
                .single();

              if (statusError) {
                console.error(`❌ 检查报告状态失败: ${statusError.message}`);
                result.errors.push(`检查报告 ${report.id} 状态失败: ${statusError.message}`);
                continue;
              }

              if (currentReport.status === 'analyzing') {
                const reportCompleted = await completeReport(supabaseUrl, supabaseKey, report.id);
                if (reportCompleted) {
                  result.completed_reports++;
                }
              } else {
                console.log(`⚠️ 报告 ${report.id} 状态已变更为 ${currentReport.status}，跳过完成处理`);
              }
            }
          }
        }

      } catch (error) {
        console.error(`❌ 处理报告 ${report.id} 时出错:`, error);
        result.errors.push(`处理报告 ${report.id} 失败: ${error.message}`);
      }
    }

    // 3. 记录执行结果
    result.execution_time = Date.now() - startTime;
    
    console.log('📊 批次处理器执行完成:', result);

    // 记录到数据库（如果表存在）
    try {
      await supabase
        .from('cron_execution_log')
        .insert({
          function_name: 'cron-batch-processor',
          execution_time: result.execution_time,
          result: result,
          executed_at: new Date().toISOString()
        });
    } catch (logError) {
      console.log('执行日志记录失败:', logError);
    }

    return new Response(JSON.stringify({
      success: true,
      message: '批次处理器执行完成',
      result
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('❌ 批次处理器执行失败:', error);
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      execution_time: Date.now() - startTime
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

// 调用process-analysis-batch-v2处理批次
async function processBatches(supabaseUrl: string, supabaseKey: string, reportId: string): Promise<boolean> {
  try {
    console.log(`🔄 调用process-analysis-batch-v2处理报告 ${reportId}`);

    const response = await fetch(`${supabaseUrl}/functions/v1/process-analysis-batch-v2`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ reportId })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ process-analysis-batch-v2调用失败: ${response.status} - ${errorText}`);
      return false;
    }

    const result = await response.json();
    console.log(`✅ process-analysis-batch-v2调用成功:`, result);
    return true;

  } catch (error) {
    console.error(`❌ 调用process-analysis-batch-v2时出错:`, error);
    return false;
  }
}

// 调用complete-report-analysis完成报告
async function completeReport(supabaseUrl: string, supabaseKey: string, reportId: string): Promise<boolean> {
  try {
    console.log(`🔄 调用complete-report-analysis完成报告 ${reportId}`);

    const response = await fetch(`${supabaseUrl}/functions/v1/complete-report-analysis`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ reportId })
    });

    if (!response.ok) {
      const errorText = await response.text();

      // Check if the error is due to report already being processed
      if (response.status === 409 || errorText.includes('already completed') || errorText.includes('already being processed')) {
        console.log(`⚠️ 报告 ${reportId} 已经在处理中或已完成，跳过`);
        return true; // Consider this as success to avoid retries
      }

      console.error(`❌ complete-report-analysis调用失败: ${response.status} - ${errorText}`);
      return false;
    }

    const result = await response.json();
    console.log(`✅ complete-report-analysis调用成功:`, result);
    return true;

  } catch (error) {
    console.error(`❌ 调用complete-report-analysis时出错:`, error);
    return false;
  }
}

// 恢复卡住的processing任务
async function recoverStuckTasks(supabase: any, reportId: string): Promise<void> {
  try {
    const STUCK_TIMEOUT_MINUTES = 10; // 10分钟超时阈值

    // 查找长时间处于processing状态的任务
    const { data: stuckTasks, error: stuckError } = await supabase
      .from('analysis_tasks')
      .select('id, batch_index, updated_at')
      .eq('report_id', reportId)
      .eq('status', 'processing')
      .lt('updated_at', new Date(Date.now() - STUCK_TIMEOUT_MINUTES * 60 * 1000).toISOString());

    if (stuckError) {
      console.error(`❌ 查询卡住任务失败: ${stuckError.message}`);
      return;
    }

    if (stuckTasks && stuckTasks.length > 0) {
      console.log(`🔧 发现 ${stuckTasks.length} 个卡住的任务，正在恢复...`);

      // 将卡住的任务重置为pending状态
      const { error: resetError } = await supabase
        .from('analysis_tasks')
        .update({
          status: 'pending',
          updated_at: new Date().toISOString(),
          error_message: `Recovered from stuck processing state (timeout after ${STUCK_TIMEOUT_MINUTES} minutes)`
        })
        .in('id', stuckTasks.map(task => task.id));

      if (resetError) {
        console.error(`❌ 重置卡住任务失败: ${resetError.message}`);
      } else {
        console.log(`✅ 成功恢复 ${stuckTasks.length} 个卡住的任务`);

        // 记录恢复操作到系统指标
        try {
          await supabase
            .from('system_metrics')
            .insert({
              metric_type: 'stuck_tasks_recovered',
              metric_value: stuckTasks.length,
              metric_unit: 'count',
              details: {
                report_id: reportId,
                recovered_task_ids: stuckTasks.map(t => t.id),
                timeout_minutes: STUCK_TIMEOUT_MINUTES
              },
              created_at: new Date().toISOString()
            });
        } catch (metricError) {
          console.warn('记录恢复指标失败:', metricError);
        }
      }
    }
  } catch (error) {
    console.error(`❌ 恢复卡住任务时出错:`, error);
  }
}