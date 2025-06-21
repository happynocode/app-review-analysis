/*
  # App Review Analysis - 完整数据库架构
  # 创建日期: 2025年1月
  # 版本: v2.0 - 优化架构
  
  此文件包含完整的数据库架构，包括：
  1. 核心业务表 (users, reports, themes, quotes, suggestions)
  2. 抓取系统表 (scraping_sessions, scraped_reviews)
  3. 分析处理表 (analysis_tasks, processing_queue)
  4. 监控系统表 (system_metrics, alert_logs, cron_execution_log)
  5. 所有必要的索引、RLS策略和视图
*/

-- ============================================================================
-- 1. 核心业务表
-- ============================================================================

-- 用户表 (扩展auth.users)
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 分析报告主表
CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'processing', 'completed', 'error', 'scraping', 'analyzing', 'scraping_completed', 'failed')),
  time_period text DEFAULT '1_month' 
    CHECK (time_period IN ('1_week', '1_month', '3_months', 'all')),
  scraped_date_range jsonb,
  analysis_started_at timestamptz,
  analysis_completed_at timestamptz,
  error_details jsonb,
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

-- 分析主题表
CREATE TABLE IF NOT EXISTS themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 主题引用表
CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_id uuid NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  text text NOT NULL,
  source text NOT NULL,
  review_date date NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- 改进建议表
CREATE TABLE IF NOT EXISTS suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_id uuid NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  text text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- 2. 抓取系统表
-- ============================================================================

-- 抓取会话表
CREATE TABLE IF NOT EXISTS scraping_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  app_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'running', 'completed', 'error')),
  total_reviews_found integer DEFAULT 0,
  app_store_reviews integer DEFAULT 0,
  google_play_reviews integer DEFAULT 0,
  reddit_posts integer DEFAULT 0,
  error_message text,
  started_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- 抓取的评论数据表
CREATE TABLE IF NOT EXISTS scraped_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scraping_session_id uuid NOT NULL REFERENCES scraping_sessions(id) ON DELETE CASCADE,
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('app_store', 'google_play', 'reddit')),
  review_text text NOT NULL,
  rating integer,
  review_date date,
  author_name text,
  source_url text,
  additional_data jsonb,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- 3. 分析处理表
-- ============================================================================

-- 分析任务表
CREATE TABLE IF NOT EXISTS analysis_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  scraping_session_id uuid NOT NULL REFERENCES scraping_sessions(id) ON DELETE CASCADE,
  batch_index integer NOT NULL,
  analysis_type text DEFAULT 'comprehensive' CHECK (analysis_type IN ('sentiment', 'themes', 'keywords', 'issues', 'comprehensive')),
  priority integer DEFAULT 5,
  status text NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  reviews_data jsonb NOT NULL,
  themes_data jsonb,
  processing_duration integer, -- 处理时间（秒）
  error_message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 并行处理队列表
CREATE TABLE IF NOT EXISTS processing_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  priority integer DEFAULT 5,
  status text DEFAULT 'queued' 
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  retry_count integer DEFAULT 0,
  max_retries integer DEFAULT 3,
  retry_at timestamptz,
  scheduled_at timestamptz DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  processing_duration integer, -- 处理时间（秒）
  error_details jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 处理日志表
CREATE TABLE IF NOT EXISTS processing_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  batch_id uuid,
  task_id uuid,
  event_type text NOT NULL, -- 'started', 'completed', 'failed', 'retry_scheduled'
  details jsonb,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- 4. 监控系统表
-- ============================================================================

-- 系统指标表
CREATE TABLE IF NOT EXISTS system_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_type text NOT NULL, -- 'processing_time', 'error_rate', 'throughput', etc.
  metric_value numeric NOT NULL,
  metric_unit text,
  details jsonb,
  timestamp timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- 系统告警表
CREATE TABLE IF NOT EXISTS system_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id text NOT NULL,
  rule_id text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  message text NOT NULL,
  alert_data jsonb,
  acknowledged boolean DEFAULT false,
  acknowledged_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- 告警日志表
CREATE TABLE IF NOT EXISTS alert_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type text NOT NULL,
  severity text CHECK (severity IN ('info', 'warning', 'error', 'critical')) DEFAULT 'info',
  message text NOT NULL,
  details jsonb,
  resolved boolean DEFAULT false,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Cron执行日志表
CREATE TABLE IF NOT EXISTS cron_execution_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name text NOT NULL,
  execution_time integer NOT NULL, -- 执行时间（毫秒）
  result jsonb,
  error_details jsonb,
  executed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- 5. 性能索引
-- ============================================================================

-- 核心表索引
CREATE INDEX IF NOT EXISTS idx_reports_user_status ON reports(user_id, status);
CREATE INDEX IF NOT EXISTS idx_reports_status_created ON reports(status, created_at DESC);

-- 抓取相关索引
CREATE INDEX IF NOT EXISTS idx_scraped_reviews_session ON scraped_reviews(scraping_session_id);
CREATE INDEX IF NOT EXISTS idx_scraped_reviews_report ON scraped_reviews(report_id);
CREATE INDEX IF NOT EXISTS idx_scraped_reviews_platform ON scraped_reviews(platform, review_date DESC);

-- 处理队列索引
CREATE INDEX IF NOT EXISTS idx_processing_queue_status_priority ON processing_queue(status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_processing_queue_scheduled ON processing_queue(scheduled_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_processing_queue_report ON processing_queue(report_id);

-- 分析任务索引
CREATE INDEX IF NOT EXISTS idx_analysis_tasks_report_status ON analysis_tasks(report_id, status);
CREATE INDEX IF NOT EXISTS idx_analysis_tasks_batch ON analysis_tasks(batch_index);

-- 监控相关索引
CREATE INDEX IF NOT EXISTS idx_system_metrics_type_time ON system_metrics(metric_type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_cron_log_function_time ON cron_execution_log(function_name, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_alert_logs_type_severity ON alert_logs(alert_type, severity);
CREATE INDEX IF NOT EXISTS idx_processing_logs_report ON processing_logs(report_id, created_at DESC);

-- ============================================================================
-- 6. Row Level Security (RLS) 策略
-- ============================================================================

-- 启用RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraping_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraped_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_tasks ENABLE ROW LEVEL SECURITY;

-- 系统表不启用RLS (供系统内部使用)
-- processing_queue, system_metrics, alert_logs, cron_execution_log

-- 用户策略
CREATE POLICY "Users can manage own data" ON users
  FOR ALL TO authenticated USING (auth.uid() = id);

-- 报告策略
CREATE POLICY "Users can manage own reports" ON reports
  FOR ALL TO authenticated USING (auth.uid() = user_id);

-- 主题策略
CREATE POLICY "Users can access themes of own reports" ON themes
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM reports WHERE reports.id = themes.report_id AND reports.user_id = auth.uid())
  );

-- 引用策略
CREATE POLICY "Users can access quotes of own themes" ON quotes
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM themes 
      JOIN reports ON reports.id = themes.report_id
      WHERE themes.id = quotes.theme_id AND reports.user_id = auth.uid()
    )
  );

-- 建议策略
CREATE POLICY "Users can access suggestions of own themes" ON suggestions
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM themes 
      JOIN reports ON reports.id = themes.report_id
      WHERE themes.id = suggestions.theme_id AND reports.user_id = auth.uid()
    )
  );

-- 抓取会话策略
CREATE POLICY "Users can access own scraping sessions" ON scraping_sessions
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM reports WHERE reports.id = scraping_sessions.report_id AND reports.user_id = auth.uid())
  );

-- 评论数据策略
CREATE POLICY "Users can access reviews of own sessions" ON scraped_reviews
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM scraping_sessions 
      JOIN reports ON reports.id = scraping_sessions.report_id
      WHERE scraping_sessions.id = scraped_reviews.scraping_session_id AND reports.user_id = auth.uid()
    )
  );

-- 分析任务策略
CREATE POLICY "Users can access analysis tasks of own reports" ON analysis_tasks
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM reports WHERE reports.id = analysis_tasks.report_id AND reports.user_id = auth.uid())
  );

-- ============================================================================
-- 7. 监控和分析视图
-- ============================================================================

-- 性能统计视图
CREATE OR REPLACE VIEW performance_stats AS
SELECT 
  DATE_TRUNC('hour', created_at) as hour,
  COUNT(*) as total_tasks,
  COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_tasks,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_tasks,
  COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing_tasks,
  AVG(processing_duration) as avg_processing_time_seconds
FROM processing_queue 
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE_TRUNC('hour', created_at)
ORDER BY hour DESC;

-- 报告状态统计视图
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

-- 实时监控仪表板视图
CREATE OR REPLACE VIEW monitoring_dashboard AS
SELECT 
  'system_overview' as section,
  json_build_object(
    'active_reports', (SELECT COUNT(*) FROM reports WHERE status IN ('scraping', 'analyzing')),
    'processing_tasks', (SELECT COUNT(*) FROM processing_queue WHERE status = 'processing'),
    'queued_tasks', (SELECT COUNT(*) FROM processing_queue WHERE status = 'queued'),
    'failed_tasks_24h', (SELECT COUNT(*) FROM processing_queue WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '24 hours'),
    'avg_response_time_24h', (SELECT AVG(execution_time) FROM cron_execution_log WHERE executed_at >= NOW() - INTERVAL '24 hours'),
    'success_rate_24h', (
      SELECT COALESCE(ROUND(
        (COUNT(CASE WHEN status = 'completed' THEN 1 END)::float / NULLIF(COUNT(*), 0) * 100), 2
      ), 0)
      FROM processing_queue 
      WHERE created_at >= NOW() - INTERVAL '24 hours'
    ),
    'total_reviews', (SELECT COUNT(*) FROM scraped_reviews),
    'total_users', (SELECT COUNT(*) FROM users)
  ) as metrics
UNION ALL
SELECT 
  'performance_trends' as section,
  json_build_object(
    'hourly_throughput', (SELECT COALESCE(json_agg(json_build_object('hour', hour, 'completed', completed_tasks)), '[]'::json) FROM performance_stats LIMIT 24),
    'error_distribution', (
      SELECT COALESCE(json_object_agg(severity, count), '{}'::json)
      FROM (
        SELECT severity, COUNT(*) as count 
        FROM alert_logs 
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY severity
      ) subq
    )
  ) as metrics;

-- ============================================================================
-- 8. 实用函数
-- ============================================================================

-- 批量分析表函数
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

-- 清理旧数据函数
CREATE OR REPLACE FUNCTION cleanup_old_data()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count integer;
  result text := '';
BEGIN
  -- 清理超过6个月的system_metrics
  DELETE FROM system_metrics WHERE created_at < NOW() - INTERVAL '6 months';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || 'Deleted ' || deleted_count || ' old system_metrics; ';
  
  -- 清理超过3个月的cron_execution_log
  DELETE FROM cron_execution_log WHERE created_at < NOW() - INTERVAL '3 months';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || 'Deleted ' || deleted_count || ' old cron logs; ';
  
  -- 清理已解决的超过30天的alert_logs
  DELETE FROM alert_logs WHERE resolved = true AND resolved_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || 'Deleted ' || deleted_count || ' resolved alerts; ';
  
  -- 清理超过1年的已完成processing_queue记录
  DELETE FROM processing_queue WHERE status = 'completed' AND completed_at < NOW() - INTERVAL '1 year';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  result := result || 'Deleted ' || deleted_count || ' old processing records; ';
  
  RETURN result;
END;
$$;

-- ============================================================================
-- 9. 初始化数据
-- ============================================================================

-- 插入系统初始化指标
INSERT INTO system_metrics (metric_type, metric_value, metric_unit, details) VALUES
('system_initialization', 1, 'boolean', '{"version": "v2.0", "schema": "complete"}'),
('tables_created', 14, 'count', '{"type": "all_tables"}'),
('indexes_created', 15, 'count', '{"type": "performance_indexes"}'),
('views_created', 3, 'count', '{"type": "monitoring_views"}'),
('functions_created', 2, 'count', '{"type": "utility_functions"}')
ON CONFLICT DO NOTHING;

-- 记录schema初始化完成
INSERT INTO cron_execution_log (function_name, execution_time, result) VALUES
('complete_schema_init', 0, '{"status": "success", "message": "完整数据库架构初始化完成", "version": "v2.0"}');

-- ============================================================================
-- 10. 表注释
-- ============================================================================

COMMENT ON TABLE users IS '用户账户表，扩展Supabase auth.users';
COMMENT ON TABLE reports IS '分析报告主表，存储应用分析请求和状态';
COMMENT ON TABLE themes IS '分析主题表，存储从评论中提取的主题';
COMMENT ON TABLE quotes IS '主题引用表，存储支持主题的具体评论片段';
COMMENT ON TABLE suggestions IS '改进建议表，存储基于主题的产品改进建议';
COMMENT ON TABLE scraping_sessions IS '抓取会话表，管理数据抓取过程';
COMMENT ON TABLE scraped_reviews IS '抓取评论表，存储从各平台获取的评论数据';
COMMENT ON TABLE analysis_tasks IS '分析任务表，管理评论分析处理任务';
COMMENT ON TABLE processing_queue IS '并行处理队列表，支持高效批量处理';
COMMENT ON TABLE processing_logs IS '处理日志表，记录任务执行过程';
COMMENT ON TABLE system_metrics IS '系统指标表，存储性能和监控数据';
COMMENT ON TABLE system_alerts IS '系统告警表，存储自动触发的告警';
COMMENT ON TABLE alert_logs IS '告警日志表，记录所有告警事件';
COMMENT ON TABLE cron_execution_log IS 'Cron执行日志表，记录定时任务执行情况';

COMMENT ON VIEW performance_stats IS '性能统计视图，提供按小时聚合的处理统计';
COMMENT ON VIEW report_status_stats IS '报告状态统计视图，分析报告处理效率';
COMMENT ON VIEW monitoring_dashboard IS '监控仪表板视图，提供系统实时概览';

-- 架构初始化完成
SELECT 'App Review Analysis 数据库架构 v2.0 初始化完成' as status; 