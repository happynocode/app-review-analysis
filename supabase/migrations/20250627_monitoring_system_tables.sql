-- 监控系统数据库表创建脚本
-- 执行日期: 2025年1月
-- 用途: 支持cron监控和性能分析

-- 1. cron执行日志表
CREATE TABLE IF NOT EXISTS cron_execution_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name text NOT NULL,
  execution_time integer NOT NULL, -- 执行时间（毫秒）
  result jsonb, -- 执行结果
  error_details jsonb, -- 错误详情（如果失败）
  executed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- 2. 系统监控指标表
CREATE TABLE IF NOT EXISTS system_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_name text NOT NULL, -- 指标名称
  metric_value numeric NOT NULL, -- 指标值
  metric_unit text, -- 单位
  tags jsonb, -- 标签
  timestamp timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- 3. 告警记录表
CREATE TABLE IF NOT EXISTS alert_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type text NOT NULL, -- 告警类型
  severity text CHECK (severity IN ('info', 'warning', 'error', 'critical')) DEFAULT 'info',
  message text NOT NULL, -- 告警消息
  details jsonb, -- 详细信息
  resolved boolean DEFAULT false, -- 是否已解决
  resolved_at timestamptz, -- 解决时间
  created_at timestamptz DEFAULT now()
);

-- 4. 添加索引优化查询性能
CREATE INDEX IF NOT EXISTS idx_cron_execution_log_function_name 
ON cron_execution_log(function_name);

CREATE INDEX IF NOT EXISTS idx_cron_execution_log_executed_at 
ON cron_execution_log(executed_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_metrics_name_timestamp 
ON system_metrics(metric_name, timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_system_metrics_timestamp 
ON system_metrics(timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_alert_logs_type_created 
ON alert_logs(alert_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_logs_severity_resolved 
ON alert_logs(severity, resolved);

-- 5. 创建性能统计视图
CREATE OR REPLACE VIEW performance_stats AS
SELECT 
  DATE_TRUNC('hour', created_at) as hour,
  COUNT(*) as total_tasks,
  COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_tasks,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_tasks,
  COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing_tasks,
  AVG(CASE WHEN completed_at IS NOT NULL AND started_at IS NOT NULL 
      THEN EXTRACT(EPOCH FROM (completed_at - started_at)) 
      END) as avg_processing_time_seconds
FROM processing_queue 
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE_TRUNC('hour', created_at)
ORDER BY hour DESC;

-- 6. 创建报告状态统计视图
CREATE OR REPLACE VIEW report_status_stats AS
SELECT 
  status,
  COUNT(*) as count,
  AVG(CASE WHEN analysis_completed_at IS NOT NULL AND analysis_started_at IS NOT NULL 
      THEN EXTRACT(EPOCH FROM (analysis_completed_at - analysis_started_at)) 
      END) as avg_analysis_time_seconds
FROM reports 
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY status;

-- 7. 创建系统分析函数
CREATE OR REPLACE FUNCTION analyze_tables(table_names text[])
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  table_name text;
  result text := '';
BEGIN
  FOREACH table_name IN ARRAY table_names
  LOOP
    EXECUTE format('ANALYZE %I', table_name);
    result := result || table_name || ' analyzed; ';
  END LOOP;
  
  RETURN result;
END;
$$;

-- 8. 创建监控仪表板视图
CREATE OR REPLACE VIEW monitoring_dashboard AS
SELECT 
  'system_overview' as section,
  json_build_object(
    'active_reports', (SELECT COUNT(*) FROM reports WHERE status IN ('scraping', 'analyzing')),
    'processing_tasks', (SELECT COUNT(*) FROM processing_queue WHERE status = 'processing'),
    'queued_tasks', (SELECT COUNT(*) FROM processing_queue WHERE status = 'queued'),
    'failed_tasks_24h', (SELECT COUNT(*) FROM processing_queue WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '24 hours'),
    'avg_response_time_24h', (SELECT AVG(execution_time) FROM cron_execution_log WHERE executed_at >= NOW() - INTERVAL '24 hours')
  ) as metrics
UNION ALL
SELECT 
  'performance_trends' as section,
  json_build_object(
    'hourly_throughput', (SELECT json_agg(json_build_object('hour', hour, 'completed', completed_tasks)) FROM performance_stats LIMIT 24),
    'success_rate_24h', (
      SELECT ROUND(
        (COUNT(CASE WHEN status = 'completed' THEN 1 END)::float / COUNT(*) * 100), 2
      ) 
      FROM processing_queue 
      WHERE created_at >= NOW() - INTERVAL '24 hours'
    )
  ) as metrics;

-- 9. 设置RLS策略（Row Level Security）
ALTER TABLE cron_execution_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_logs ENABLE ROW LEVEL SECURITY;

-- 允许service role访问所有数据
CREATE POLICY "Service role access" ON cron_execution_log FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role access" ON system_metrics FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role access" ON alert_logs FOR ALL USING (auth.role() = 'service_role');

-- 10. 插入初始监控数据
INSERT INTO system_metrics (metric_name, metric_value, metric_unit, tags) VALUES
('system_initialization', 1, 'boolean', '{"component": "monitoring", "version": "v2"}'),
('tables_created', 3, 'count', '{"type": "monitoring_tables"}'),
('indexes_created', 6, 'count', '{"type": "performance_indexes"}'),
('views_created', 3, 'count', '{"type": "dashboard_views"}')
ON CONFLICT DO NOTHING;

-- 完成监控系统初始化
INSERT INTO cron_execution_log (function_name, execution_time, result) VALUES
('monitoring_system_init', 0, '{"status": "success", "message": "监控系统数据库表创建完成"}');

COMMENT ON TABLE cron_execution_log IS '定时任务执行日志，记录各个cron函数的执行情况';
COMMENT ON TABLE system_metrics IS '系统性能指标，用于监控和分析系统运行状态';  
COMMENT ON TABLE alert_logs IS '告警日志，记录系统异常和通知信息';
COMMENT ON VIEW performance_stats IS '性能统计视图，提供按小时聚合的任务处理统计';
COMMENT ON VIEW report_status_stats IS '报告状态统计视图，分析报告处理效率';
COMMENT ON VIEW monitoring_dashboard IS '监控仪表板视图，提供系统概览和性能趋势'; 