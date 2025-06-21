-- ============================================================================
-- Cron Jobs 管理脚本 - 不使用Vault版本
-- ============================================================================

-- ⚠️ 重要说明：
-- 请将下面的 'YOUR_PROJECT_URL' 和 'YOUR_SERVICE_ROLE_KEY' 
-- 替换为您的实际Supabase项目URL和Service Role密钥

-- ============================================================================
-- 🗑️ 1. 删除所有现有的cron jobs
-- ============================================================================

DO $$
DECLARE
    job_record RECORD;
BEGIN
    -- 显示当前的cron jobs
    RAISE NOTICE '当前的cron jobs:';
    FOR job_record IN SELECT jobid, jobname FROM cron.job LOOP
        RAISE NOTICE '  Job ID: %, Name: %', job_record.jobid, job_record.jobname;
    END LOOP;
    
    -- 删除所有现有的cron jobs
    FOR job_record IN SELECT jobid FROM cron.job LOOP
        PERFORM cron.unschedule(job_record.jobid);
        RAISE NOTICE '已删除 cron job ID: %', job_record.jobid;
    END LOOP;
    
    RAISE NOTICE '✅ 所有现有的 cron jobs 已删除完成';
END $$;

-- ============================================================================
-- 🚀 2. 创建新的cron jobs
-- ============================================================================

-- 2.1 cron-analysis-monitor - 分析监控 (每分钟执行)
SELECT cron.schedule(
    'cron-analysis-monitor',
    '* * * * *',
    $cron$
    SELECT
        net.http_post(
            url := 'https://mihmdokivbllrcrjoojo.supabase.co/functions/v1/cron-analysis-monitor',
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1paG1kb2tpdmJsbHJjcmpvb2pvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDM1MDU4MiwiZXhwIjoyMDY1OTI2NTgyfQ.6JvQz2LkRl5b0QoVQaEZVn6Vb9C1r3C05jZxPiTI7WI'
            ),
            body := jsonb_build_object(
                'timestamp', now(),
                'trigger', 'cron-scheduler'
            )
        ) as request_id;
    $cron$
) as analysis_monitor_job_id;

-- 2.2 cron-scraping-monitor - 抓取监控 (每2分钟执行)
SELECT cron.schedule(
    'cron-scraping-monitor',
    '* * * * *',
    $cron$
    SELECT
        net.http_post(
            url := 'https://mihmdokivbllrcrjoojo.supabase.co/functions/v1/cron-scraping-monitor',
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1paG1kb2tpdmJsbHJjcmpvb2pvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDM1MDU4MiwiZXhwIjoyMDY1OTI2NTgyfQ.6JvQz2LkRl5b0QoVQaEZVn6Vb9C1r3C05jZxPiTI7WI'
            ),
            body := jsonb_build_object(
                'timestamp', now(),
                'trigger', 'cron-scheduler'
            )
        ) as request_id;
    $cron$
) as scraping_monitor_job_id;

-- 2.3 cron-batch-recovery - 批次恢复 (每10分钟执行)
SELECT cron.schedule(
    'cron-batch-recovery',
    '*/5 * * * *',
    $cron$
    SELECT
        net.http_post(
            url := 'https://mihmdokivbllrcrjoojo.supabase.co/functions/v1/cron-batch-recovery',
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1paG1kb2tpdmJsbHJjcmpvb2pvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDM1MDU4MiwiZXhwIjoyMDY1OTI2NTgyfQ.6JvQz2LkRl5b0QoVQaEZVn6Vb9C1r3C05jZxPiTI7WI'
            ),
            body := jsonb_build_object(
                'timestamp', now(),
                'trigger', 'cron-scheduler'
            )
        ) as request_id;
    $cron$
) as batch_recovery_job_id;

-- 2.4 cron-cleanup-tasks - 清理任务 (每天午夜执行)
SELECT cron.schedule(
    'cron-cleanup-tasks',
    '0 0 * * *',
    $cron$
    SELECT
        net.http_post(
            url := 'https://mihmdokivbllrcrjoojo.supabase.co/functions/v1/cron-cleanup-tasks',
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1paG1kb2tpdmJsbHJjcmpvb2pvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MDM1MDU4MiwiZXhwIjoyMDY1OTI2NTgyfQ.6JvQz2LkRl5b0QoVQaEZVn6Vb9C1r3C05jZxPiTI7WI'
            ),
            body := jsonb_build_object(
                'timestamp', now(),
                'trigger', 'cron-scheduler'
            )
        ) as request_id;
    $cron$
) as cleanup_tasks_job_id;

-- ============================================================================
-- 📋 3. 验证创建结果
-- ============================================================================

-- 查看新创建的cron jobs
SELECT 
    jobid,
    jobname,
    schedule,
    active,
    CASE 
        WHEN jobname = 'cron-analysis-monitor' THEN '分析监控 - 每分钟执行'
        WHEN jobname = 'cron-scraping-monitor' THEN '抓取监控 - 每2分钟执行'
        WHEN jobname = 'cron-batch-recovery' THEN '批次恢复 - 每10分钟执行'
        WHEN jobname = 'cron-cleanup-tasks' THEN '清理任务 - 每天午夜执行'
        ELSE '其他任务'
    END as description,
    created_at
FROM cron.job 
WHERE jobname IN ('cron-analysis-monitor', 'cron-scraping-monitor', 'cron-batch-recovery', 'cron-cleanup-tasks')
ORDER BY jobid;

-- ============================================================================
-- 🔍 4. 创建监控视图
-- ============================================================================

-- Cron执行状态监控视图
CREATE OR REPLACE VIEW cron_monitoring AS
SELECT 
    j.jobname,
    j.schedule,
    j.active,
    jrd.status,
    jrd.start_time,
    jrd.end_time,
    jrd.return_message,
    CASE 
        WHEN jrd.end_time IS NOT NULL AND jrd.start_time IS NOT NULL 
        THEN EXTRACT(EPOCH FROM (jrd.end_time - jrd.start_time))
        ELSE NULL 
    END as duration_seconds
FROM cron.job j
LEFT JOIN cron.job_run_details jrd ON j.jobid = jrd.jobid
WHERE j.jobname IN ('cron-analysis-monitor', 'cron-scraping-monitor', 'cron-batch-recovery', 'cron-cleanup-tasks')
ORDER BY jrd.start_time DESC NULLS LAST;

-- 系统健康检查视图
CREATE OR REPLACE VIEW system_health_check AS
SELECT 
    'cron_jobs' as component,
    COUNT(*) as total_jobs,
    COUNT(CASE WHEN active = true THEN 1 END) as active_jobs,
    COUNT(CASE WHEN active = false THEN 1 END) as inactive_jobs,
    now() as check_time
FROM cron.job
WHERE jobname IN ('cron-analysis-monitor', 'cron-scraping-monitor', 'cron-batch-recovery', 'cron-cleanup-tasks')
UNION ALL
SELECT 
    'recent_executions' as component,
    COUNT(*) as total_executions,
    COUNT(CASE WHEN status = 'succeeded' THEN 1 END) as successful_executions,
    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_executions,
    now() as check_time
FROM cron.job_run_details jrd
JOIN cron.job j ON j.jobid = jrd.jobid
WHERE j.jobname IN ('cron-analysis-monitor', 'cron-scraping-monitor', 'cron-batch-recovery', 'cron-cleanup-tasks')
  AND jrd.start_time >= NOW() - INTERVAL '1 hour';

-- ============================================================================
-- 📊 5. 记录配置完成
-- ============================================================================

INSERT INTO cron_execution_log (function_name, execution_time, result) VALUES
('cron_jobs_setup_direct', 0, jsonb_build_object(
    'status', 'success',
    'message', 'Cron jobs 配置完成 (直接配置模式)',
    'jobs_created', 4,
    'jobs', jsonb_build_array(
        'cron-analysis-monitor',
        'cron-scraping-monitor', 
        'cron-batch-recovery',
        'cron-cleanup-tasks'
    ),
    'schedules', jsonb_build_object(
        'cron-analysis-monitor', '* * * * * (每分钟)',
        'cron-scraping-monitor', '*/2 * * * * (每2分钟)',
        'cron-batch-recovery', '*/10 * * * * (每10分钟)',
        'cron-cleanup-tasks', '0 0 * * * (每天午夜)'
    ),
    'method', 'direct_configuration',
    'timestamp', now()
));

-- ============================================================================
-- ✅ 6. 完成提示和验证命令
-- ============================================================================

DO $$
DECLARE
    job_count integer;
BEGIN
    SELECT COUNT(*) INTO job_count 
    FROM cron.job 
    WHERE jobname IN ('cron-analysis-monitor', 'cron-scraping-monitor', 'cron-batch-recovery', 'cron-cleanup-tasks');
    
    RAISE NOTICE '🎉 Cron Jobs 配置完成！';
    RAISE NOTICE '';
    RAISE NOTICE '📊 成功创建 % 个任务:', job_count;
    RAISE NOTICE '   1. cron-analysis-monitor (每分钟) - 分析监控';
    RAISE NOTICE '   2. cron-scraping-monitor (每2分钟) - 抓取监控';  
    RAISE NOTICE '   3. cron-batch-recovery (每10分钟) - 批次恢复';
    RAISE NOTICE '   4. cron-cleanup-tasks (每天午夜) - 清理任务';
    RAISE NOTICE '';
    RAISE NOTICE '🔍 验证命令:';
    RAISE NOTICE '   查看任务状态: SELECT * FROM cron.job WHERE jobname LIKE ''cron-%'';';
    RAISE NOTICE '   查看监控视图: SELECT * FROM cron_monitoring LIMIT 10;';
    RAISE NOTICE '   查看系统健康: SELECT * FROM system_health_check;';
    RAISE NOTICE '   查看执行历史: SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;';
    RAISE NOTICE '';
    RAISE NOTICE '⚠️  重要提醒: 请确保已将脚本中的YOUR_PROJECT_URL和YOUR_SERVICE_ROLE_KEY替换为实际值！';
    RAISE NOTICE '';
    RAISE NOTICE '🔧 如果需要修改URL或密钥，请运行:';
    RAISE NOTICE '   1. 先删除jobs: SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname LIKE ''cron-%'';';
    RAISE NOTICE '   2. 然后重新运行此脚本';
END $$;

-- ============================================================================
-- 🔧 7. 实用管理命令（注释掉，需要时取消注释使用）
-- ============================================================================

-- 暂停所有cron jobs
-- UPDATE cron.job SET active = false WHERE jobname IN ('cron-analysis-monitor', 'cron-scraping-monitor', 'cron-batch-recovery', 'cron-cleanup-tasks');

-- 重新启用所有cron jobs  
-- UPDATE cron.job SET active = true WHERE jobname IN ('cron-analysis-monitor', 'cron-scraping-monitor', 'cron-batch-recovery', 'cron-cleanup-tasks');

-- 删除特定的cron job
-- SELECT cron.unschedule('cron-analysis-monitor');

-- 查看最近的执行日志
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;

-- 查看网络请求日志
-- SELECT * FROM net._http_response ORDER BY created DESC LIMIT 10;