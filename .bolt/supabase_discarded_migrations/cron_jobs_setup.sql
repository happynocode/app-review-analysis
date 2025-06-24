-- =========================================================================
-- ReviewInsight - 定时作业配置脚本
-- 配置数据清理、监控和维护任务
-- =========================================================================

-- 注意：此脚本需要在主数据库部署完成后单独执行
-- 确保已安装 pg_cron 扩展并具有必要的权限

-- 清理旧的系统指标数据（保留30天）
-- ============================
SELECT cron.schedule(
    'cleanup-old-metrics',
    '0 2 * * *', -- 每天凌晨2点执行
    'DELETE FROM public.system_metrics WHERE created_at < now() - interval ''30 days'';'
);

-- 清理旧的定时任务执行日志（保留7天）
-- ===============================
SELECT cron.schedule(
    'cleanup-old-cron-logs',
    '0 3 * * *', -- 每天凌晨3点执行
    'DELETE FROM public.cron_execution_log WHERE created_at < now() - interval ''7 days'';'
);

-- 清理旧的告警日志（保留90天）
-- =========================
SELECT cron.schedule(
    'cleanup-old-alert-logs',
    '0 4 * * *', -- 每天凌晨4点执行
    'DELETE FROM public.alert_logs WHERE created_at < now() - interval ''90 days'' AND resolved = true;'
);

-- 定期收集系统指标
-- ================
SELECT cron.schedule(
    'collect-system-metrics',
    '*/5 * * * *', -- 每5分钟执行一次
    $$
    INSERT INTO public.system_metrics (metric_name, metric_value, metric_unit, tags)
    VALUES 
        ('active_reports', (SELECT COUNT(*) FROM public.reports WHERE status IN ('processing', 'analyzing', 'scraping')), 'count', '{"type": "reports"}'),
        ('pending_analysis_tasks', (SELECT COUNT(*) FROM public.analysis_tasks WHERE status = 'pending'), 'count', '{"type": "tasks"}'),
        ('queued_processing_items', (SELECT COUNT(*) FROM public.processing_queue WHERE status = 'queued'), 'count', '{"type": "queue"}'),
        ('failed_reports_24h', (SELECT COUNT(*) FROM public.reports WHERE status = 'failed' AND created_at > now() - interval '24 hours'), 'count', '{"type": "reports", "timeframe": "24h"}'),
        ('completed_reports_24h', (SELECT COUNT(*) FROM public.reports WHERE status = 'completed' AND completed_at > now() - interval '24 hours'), 'count', '{"type": "reports", "timeframe": "24h"}'),
        ('avg_processing_time_minutes', (SELECT COALESCE(AVG(EXTRACT(epoch FROM (completed_at - created_at))/60), 0) FROM public.reports WHERE completed_at > now() - interval '24 hours' AND status = 'completed'), 'minutes', '{"type": "performance", "timeframe": "24h"}');
    $$
);

-- 检查异常情况并生成告警
-- ======================
SELECT cron.schedule(
    'health-check-alerts',
    '*/10 * * * *', -- 每10分钟检查一次
    $$
    DO $$
    DECLARE
        stuck_reports_count integer;
        failed_tasks_count integer;
        long_running_reports_count integer;
    BEGIN
        -- 检查卡住的报告（超过2小时没有更新）
        SELECT COUNT(*) INTO stuck_reports_count
        FROM public.reports 
        WHERE status IN ('processing', 'analyzing', 'scraping') 
            AND updated_at < now() - interval '2 hours';
            
        IF stuck_reports_count > 0 THEN
            INSERT INTO public.alert_logs (alert_type, severity, message, details)
            VALUES (
                'stuck_reports', 
                'warning', 
                'Found ' || stuck_reports_count || ' reports that appear to be stuck',
                json_build_object('count', stuck_reports_count, 'threshold_hours', 2)
            );
        END IF;
        
        -- 检查失败的分析任务
        SELECT COUNT(*) INTO failed_tasks_count
        FROM public.analysis_tasks 
        WHERE status = 'failed' 
            AND created_at > now() - interval '1 hour';
            
        IF failed_tasks_count > 5 THEN
            INSERT INTO public.alert_logs (alert_type, severity, message, details)
            VALUES (
                'high_task_failures', 
                'error', 
                'High number of failed analysis tasks in the last hour: ' || failed_tasks_count,
                json_build_object('count', failed_tasks_count, 'timeframe', '1 hour')
            );
        END IF;
        
        -- 检查长时间运行的报告（超过6小时）
        SELECT COUNT(*) INTO long_running_reports_count
        FROM public.reports 
        WHERE status IN ('processing', 'analyzing', 'scraping') 
            AND created_at < now() - interval '6 hours';
            
        IF long_running_reports_count > 0 THEN
            INSERT INTO public.alert_logs (alert_type, severity, message, details)
            VALUES (
                'long_running_reports', 
                'critical', 
                'Found ' || long_running_reports_count || ' reports running for more than 6 hours',
                json_build_object('count', long_running_reports_count, 'threshold_hours', 6)
            );
        END IF;
    END $$;
    $$
);

-- 定期分析表以保持查询性能
-- ========================
SELECT cron.schedule(
    'analyze-tables',
    '0 1 * * 0', -- 每周日凌晨1点执行
    'SELECT public.analyze_tables(ARRAY[''reports'', ''analysis_tasks'', ''scraped_reviews'', ''scraping_sessions'', ''themes'', ''quotes'', ''suggestions'']);'
);

-- 清理孤立数据
-- ============
SELECT cron.schedule(
    'cleanup-orphaned-data',
    '0 5 * * 0', -- 每周日凌晨5点执行
    $$
    -- 清理没有关联报告的孤立主题
    DELETE FROM public.themes 
    WHERE report_id NOT IN (SELECT id FROM public.reports);
    
    -- 清理没有关联主题的孤立引用
    DELETE FROM public.quotes 
    WHERE theme_id NOT IN (SELECT id FROM public.themes);
    
    -- 清理没有关联主题的孤立建议
    DELETE FROM public.suggestions 
    WHERE theme_id NOT IN (SELECT id FROM public.themes);
    
    -- 清理没有关联会话的孤立评论
    DELETE FROM public.scraped_reviews 
    WHERE scraping_session_id NOT IN (SELECT id FROM public.scraping_sessions);
    $$
);

-- 记录定时作业配置完成
INSERT INTO public.system_metrics (metric_name, metric_value, metric_unit, tags)
VALUES ('cron_jobs_configured', 1, 'boolean', json_build_object('configured_at', now(), 'jobs_count', 6));

-- 查看已配置的定时作业
SELECT 
    jobname,
    schedule,
    command,
    active
FROM cron.job
ORDER BY jobname;

-- 配置完成通知
DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'ReviewInsight 定时作业配置完成！';
    RAISE NOTICE '========================================';
    RAISE NOTICE '已配置的定时作业：';
    RAISE NOTICE '✓ cleanup-old-metrics: 每日清理旧指标数据';
    RAISE NOTICE '✓ cleanup-old-cron-logs: 每日清理定时任务日志';
    RAISE NOTICE '✓ cleanup-old-alert-logs: 每日清理告警日志';
    RAISE NOTICE '✓ collect-system-metrics: 每5分钟收集系统指标';
    RAISE NOTICE '✓ health-check-alerts: 每10分钟健康检查';
    RAISE NOTICE '✓ analyze-tables: 每周分析表性能';
    RAISE NOTICE '✓ cleanup-orphaned-data: 每周清理孤立数据';
    RAISE NOTICE '========================================';
    RAISE NOTICE '注意：确保数据库具有 pg_cron 扩展权限';
    RAISE NOTICE '========================================';
END $$; 