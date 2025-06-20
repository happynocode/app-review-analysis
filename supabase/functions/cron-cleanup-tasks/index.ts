import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

interface CleanupResult {
  deleted_failed_tasks: number;
  deleted_old_logs: number;
  deleted_expired_sessions: number;
  cleaned_temp_data: number;
  execution_time: number;
}

const FAILED_TASK_RETENTION_HOURS = 48; // 失败任务保留48小时
const LOG_RETENTION_DAYS = 7; // 日志保留7天
const SESSION_RETENTION_DAYS = 30; // 抓取会话保留30天
const TEMP_DATA_RETENTION_HOURS = 6; // 临时数据保留6小时

Deno.serve(async (req: Request) => {
  const startTime = Date.now();
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    console.log('🧹 定期清理任务开始执行...');

    const result: CleanupResult = {
      deleted_failed_tasks: 0,
      deleted_old_logs: 0,
      deleted_expired_sessions: 0,
      cleaned_temp_data: 0,
      execution_time: 0
    };

    // 1. 清理过期的失败任务
    const failedTasksCutoff = new Date(Date.now() - FAILED_TASK_RETENTION_HOURS * 60 * 60 * 1000);
    
    const { data: failedTasks, error: failedTasksError } = await supabase
      .from('processing_queue')
      .delete()
      .eq('status', 'failed')
      .lt('completed_at', failedTasksCutoff.toISOString())
      .select('count');

    if (!failedTasksError && failedTasks) {
      result.deleted_failed_tasks = failedTasks.length;
      console.log(`✅ 已清理 ${result.deleted_failed_tasks} 个过期失败任务`);
    }

    // 2. 清理过期的执行日志
    const logsCutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    
    const { data: oldLogs, error: logsError } = await supabase
      .from('cron_execution_log')
      .delete()
      .lt('executed_at', logsCutoff.toISOString())
      .select('count');

    if (!logsError && oldLogs) {
      result.deleted_old_logs = oldLogs.length;
      console.log(`✅ 已清理 ${result.deleted_old_logs} 条过期执行日志`);
    }

    // 3. 清理过期的抓取会话
    const sessionsCutoff = new Date(Date.now() - SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    
    // 首先获取过期的会话ID
    const { data: expiredSessions, error: sessionsQueryError } = await supabase
      .from('scraping_sessions')
      .select('id')
      .eq('status', 'completed')
      .lt('completed_at', sessionsCutoff.toISOString());

    if (!sessionsQueryError && expiredSessions && expiredSessions.length > 0) {
      const sessionIds = expiredSessions.map(s => s.id);
      
      // 删除相关的抓取评论
      await supabase
        .from('scraped_reviews')
        .delete()
        .in('scraping_session_id', sessionIds);

      // 删除会话记录
      const { error: sessionDeleteError } = await supabase
        .from('scraping_sessions')
        .delete()
        .in('id', sessionIds);

      if (!sessionDeleteError) {
        result.deleted_expired_sessions = expiredSessions.length;
        console.log(`✅ 已清理 ${result.deleted_expired_sessions} 个过期抓取会话及相关数据`);
      }
    }

    // 4. 清理临时数据和孤立记录
    const tempDataCutoff = new Date(Date.now() - TEMP_DATA_RETENTION_HOURS * 60 * 60 * 1000);
    
    // 清理没有关联报告的孤立分析任务
    const { data: orphanTasks, error: orphanError } = await supabase
      .from('analysis_tasks')
      .delete()
      .eq('status', 'failed')
      .lt('created_at', tempDataCutoff.toISOString())
      .is('report_id', null)
      .select('count');

    if (!orphanError && orphanTasks) {
      result.cleaned_temp_data += orphanTasks.length;
    }

    // 清理长时间处于pending状态的队列任务
    const { data: staleTasks, error: staleError } = await supabase
      .from('processing_queue')
      .delete()
      .eq('status', 'queued')
      .lt('created_at', new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()) // 12小时前的排队任务
      .select('count');

    if (!staleError && staleTasks) {
      result.cleaned_temp_data += staleTasks.length;
    }

    console.log(`🧹 临时数据清理完成：${result.cleaned_temp_data} 项`);

    // 5. 数据库维护操作
    try {
      // 更新表统计信息以优化查询性能
      await supabase.rpc('analyze_tables', { 
        table_names: ['processing_queue', 'analysis_tasks', 'scraped_reviews', 'cron_execution_log']
      });
      console.log('✅ 数据库表统计信息已更新');
    } catch (analyzeError) {
      console.log('数据库分析操作跳过:', analyzeError.message);
    }

    // 6. 生成清理报告
    result.execution_time = Date.now() - startTime;
    
    const cleanupSummary = {
      timestamp: new Date().toISOString(),
      total_cleaned_items: result.deleted_failed_tasks + result.deleted_old_logs + result.deleted_expired_sessions + result.cleaned_temp_data,
      categories: {
        failed_tasks: result.deleted_failed_tasks,
        old_logs: result.deleted_old_logs,
        expired_sessions: result.deleted_expired_sessions,
        temp_data: result.cleaned_temp_data
      },
      retention_policies: {
        failed_tasks_hours: FAILED_TASK_RETENTION_HOURS,
        logs_days: LOG_RETENTION_DAYS,
        sessions_days: SESSION_RETENTION_DAYS,
        temp_data_hours: TEMP_DATA_RETENTION_HOURS
      }
    };

    console.log('📊 清理任务执行完成:', cleanupSummary);

    // 记录清理日志
    try {
      await supabase
        .from('cron_execution_log')
        .insert({
          function_name: 'cron-cleanup-tasks',
          execution_time: result.execution_time,
          result: cleanupSummary,
          executed_at: new Date().toISOString()
        });
    } catch (logError) {
      console.log('清理日志记录失败:', logError);
    }

    // 7. 发送清理报告（如果清理了大量数据）
    if (cleanupSummary.total_cleaned_items > 100) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/alert-manager`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            type: 'cleanup_report',
            message: `定期清理完成：已清理 ${cleanupSummary.total_cleaned_items} 项数据`,
            severity: 'info',
            details: cleanupSummary
          })
        });
      } catch (alertError) {
        console.log('清理报告发送失败:', alertError);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      message: '定期清理任务执行完成',
      result: cleanupSummary
    }), {
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error('❌ 清理任务执行失败:', error);
    
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