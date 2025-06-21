-- =========================================================================
-- ReviewInsight - 完整数据库部署脚本
-- 一键部署脚本，包含所有必要的表、索引、约束、RLS政策、函数和扩展
-- =========================================================================

-- 启用必要的扩展
-- =================
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA graphql;
CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA vault;
CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA pg_catalog;

-- 创建用户表（与auth.users关联）
-- ==============================
CREATE TABLE IF NOT EXISTS public.users (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email text NOT NULL UNIQUE,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 创建报告表
-- ==========
CREATE TABLE IF NOT EXISTS public.reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    app_name text NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'error', 'scraping', 'analyzing', 'scraping_completed', 'failed')),
    time_period text DEFAULT '1_month' CHECK (time_period IN ('1_week', '1_month', '3_months', 'all')),
    scraped_date_range jsonb,
    analysis_started_at timestamptz COMMENT '分析开始时间',
    analysis_completed_at timestamptz,
    error_message text,
    failure_stage text CHECK (failure_stage IN ('scraping', 'analysis', 'completion')),
    failure_details jsonb,
    user_search_term text,
    selected_app_name text,
    enabled_platforms jsonb DEFAULT '["app_store", "google_play", "reddit"]'::jsonb,
    time_filter_days integer NOT NULL DEFAULT 90 CHECK (time_filter_days > 0 AND time_filter_days <= 365),
    is_public boolean DEFAULT false,
    created_at timestamptz DEFAULT now(),
    completed_at timestamptz,
    updated_at timestamptz DEFAULT now()
);

-- 创建主题表
-- ==========
CREATE TABLE IF NOT EXISTS public.themes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
    title text NOT NULL,
    description text NOT NULL,
    platform text CHECK (platform IN ('reddit', 'app_store', 'google_play')),
    created_at timestamptz DEFAULT now()
);

-- 创建引用表
-- ==========
CREATE TABLE IF NOT EXISTS public.quotes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    theme_id uuid NOT NULL REFERENCES public.themes(id) ON DELETE CASCADE,
    text text NOT NULL,
    source text NOT NULL,
    review_date date NOT NULL,
    created_at timestamptz DEFAULT now()
);

-- 创建建议表
-- ==========
CREATE TABLE IF NOT EXISTS public.suggestions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    theme_id uuid NOT NULL REFERENCES public.themes(id) ON DELETE CASCADE,
    text text NOT NULL,
    created_at timestamptz DEFAULT now()
);

-- 创建抓取会话表
-- ==============
CREATE TABLE IF NOT EXISTS public.scraping_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
    app_name text NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'error')),
    total_reviews_found integer DEFAULT 0,
    app_store_reviews integer DEFAULT 0,
    google_play_reviews integer DEFAULT 0,
    reddit_posts integer DEFAULT 0,
    error_message text,
    started_at timestamptz DEFAULT now(),
    completed_at timestamptz,
    created_at timestamptz DEFAULT now(),
    
    -- 平台启用状态
    enabled_platforms jsonb DEFAULT '["app_store", "google_play", "reddit"]'::jsonb COMMENT '用户选择启用的平台: ["app_store", "google_play", "reddit"]',
    
    -- 各平台抓取状态
    app_store_scraper_status text DEFAULT 'pending' CHECK (app_store_scraper_status IN ('pending', 'running', 'completed', 'failed', 'disabled')) COMMENT 'App Store scraper状态: pending/running/completed/failed/disabled',
    google_play_scraper_status text DEFAULT 'pending' CHECK (google_play_scraper_status IN ('pending', 'running', 'completed', 'failed', 'disabled')) COMMENT 'Google Play scraper状态: pending/running/completed/failed/disabled',
    reddit_scraper_status text DEFAULT 'pending' CHECK (reddit_scraper_status IN ('pending', 'running', 'completed', 'failed', 'disabled')) COMMENT 'Reddit scraper状态: pending/running/completed/failed/disabled',
    
    -- 各平台时间戳
    app_store_started_at timestamptz,
    app_store_completed_at timestamptz,
    google_play_started_at timestamptz,
    google_play_completed_at timestamptz,
    reddit_started_at timestamptz,
    reddit_completed_at timestamptz,
    
    -- 各平台错误信息
    app_store_error_message text,
    google_play_error_message text,
    reddit_error_message text,
    
    -- 分析配置和统计
    analysis_config jsonb DEFAULT '{}'::jsonb COMMENT '分析配置: redditOnly, userProvidedName等',
    user_search_term text,
    selected_app_name text,
    app_store_analysis_reviews integer DEFAULT 0 COMMENT '发送给分析的App Store评论数量（经过筛选后）',
    google_play_analysis_reviews integer DEFAULT 0 COMMENT '发送给分析的Google Play评论数量（经过筛选后）',
    reddit_analysis_posts integer DEFAULT 0 COMMENT '发送给分析的Reddit帖子数量（经过筛选后）',
    total_analysis_reviews integer DEFAULT 0 COMMENT '发送给分析的总评论数量（经过筛选后）',
    filtering_stats jsonb DEFAULT '{}'::jsonb COMMENT '筛选统计信息：原始数量、去重后数量、时间筛选后数量、质量筛选后数量等'
);

-- 创建抓取评论表
-- ==============
CREATE TABLE IF NOT EXISTS public.scraped_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scraping_session_id uuid NOT NULL REFERENCES public.scraping_sessions(id) ON DELETE CASCADE,
    platform text NOT NULL CHECK (platform IN ('app_store', 'google_play', 'reddit')),
    review_text text NOT NULL,
    rating integer,
    review_date date,
    author_name text,
    source_url text,
    additional_data jsonb,
    created_at timestamptz DEFAULT now()
);

-- 创建分析任务表
-- ==============
CREATE TABLE IF NOT EXISTS public.analysis_tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
    scraping_session_id uuid NOT NULL REFERENCES public.scraping_sessions(id) ON DELETE CASCADE,
    batch_index integer NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    reviews_data jsonb NOT NULL,
    themes_data jsonb COMMENT '主题分析结果数据',
    error_message text COMMENT '任务失败时的错误信息',
    analysis_type text DEFAULT 'sentiment_analysis',
    priority integer DEFAULT 5,
    sentiment_data jsonb COMMENT '情感分析结果数据',
    keywords_data jsonb COMMENT '关键词分析结果数据',
    issues_data jsonb COMMENT '问题分析结果数据',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
) COMMENT '分析任务表 - 简化架构后的唯一任务管理表';

-- 创建处理队列表
-- ==============
CREATE TABLE IF NOT EXISTS public.processing_queue (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id uuid NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
    batch_id uuid NOT NULL,
    priority integer DEFAULT 5,
    status text DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    retry_count integer DEFAULT 0,
    max_retries integer DEFAULT 3,
    scheduled_at timestamptz DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    error_details jsonb,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

-- 创建系统指标表
-- ==============
CREATE TABLE IF NOT EXISTS public.system_metrics (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_name text NOT NULL,
    metric_value numeric NOT NULL,
    metric_unit text,
    tags jsonb,
    timestamp timestamptz DEFAULT now(),
    created_at timestamptz DEFAULT now()
);

-- 创建告警日志表
-- ==============
CREATE TABLE IF NOT EXISTS public.alert_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_type text NOT NULL,
    severity text DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
    message text NOT NULL,
    details jsonb,
    resolved boolean DEFAULT false,
    resolved_at timestamptz,
    created_at timestamptz DEFAULT now()
);

-- 创建定时任务执行日志表
-- ======================
CREATE TABLE IF NOT EXISTS public.cron_execution_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    function_name text NOT NULL,
    execution_time integer NOT NULL,
    result jsonb,
    error_details jsonb,
    executed_at timestamptz DEFAULT now(),
    created_at timestamptz DEFAULT now()
);

-- 创建索引
-- ========

-- users 表索引
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);

-- reports 表索引
CREATE INDEX IF NOT EXISTS idx_reports_user_id ON public.reports(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON public.reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON public.reports(created_at DESC);

-- themes 表索引
CREATE INDEX IF NOT EXISTS idx_themes_report_id ON public.themes(report_id);
CREATE INDEX IF NOT EXISTS idx_themes_platform ON public.themes(platform);
CREATE INDEX IF NOT EXISTS idx_themes_report_platform ON public.themes(report_id, platform);

-- quotes 表索引
CREATE INDEX IF NOT EXISTS idx_quotes_theme_id ON public.quotes(theme_id);

-- suggestions 表索引
CREATE INDEX IF NOT EXISTS idx_suggestions_theme_id ON public.suggestions(theme_id);

-- scraping_sessions 表索引
CREATE INDEX IF NOT EXISTS idx_scraping_sessions_report_id ON public.scraping_sessions(report_id);
CREATE INDEX IF NOT EXISTS idx_scraping_sessions_status ON public.scraping_sessions(status);
CREATE INDEX IF NOT EXISTS idx_scraping_sessions_scraper_status ON public.scraping_sessions(app_store_scraper_status, google_play_scraper_status, reddit_scraper_status);
CREATE INDEX IF NOT EXISTS idx_scraping_sessions_enabled_platforms ON public.scraping_sessions USING GIN(enabled_platforms);

-- scraped_reviews 表索引
CREATE INDEX IF NOT EXISTS idx_scraped_reviews_session_id ON public.scraped_reviews(scraping_session_id);
CREATE INDEX IF NOT EXISTS idx_scraped_reviews_platform ON public.scraped_reviews(platform);
CREATE INDEX IF NOT EXISTS idx_scraped_reviews_created_at ON public.scraped_reviews(created_at DESC);

-- analysis_tasks 表索引
CREATE INDEX IF NOT EXISTS idx_analysis_tasks_report_id ON public.analysis_tasks(report_id);
CREATE INDEX IF NOT EXISTS idx_analysis_tasks_scraping_session_id ON public.analysis_tasks(scraping_session_id);
CREATE INDEX IF NOT EXISTS idx_analysis_tasks_status ON public.analysis_tasks(status);
CREATE INDEX IF NOT EXISTS idx_analysis_tasks_report_status ON public.analysis_tasks(report_id, status);
CREATE INDEX IF NOT EXISTS idx_analysis_tasks_type_status ON public.analysis_tasks(analysis_type, status);
CREATE INDEX IF NOT EXISTS idx_analysis_tasks_batch_priority ON public.analysis_tasks(batch_index, priority DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_tasks_created_at ON public.analysis_tasks(created_at DESC);

-- processing_queue 表索引
CREATE INDEX IF NOT EXISTS idx_processing_queue_status_priority ON public.processing_queue(status, priority DESC, scheduled_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_processing_queue_processing_tasks ON public.processing_queue(status, started_at) WHERE status = 'processing';
CREATE INDEX IF NOT EXISTS idx_processing_queue_report_batch ON public.processing_queue(report_id, batch_id);

-- system_metrics 表索引
CREATE INDEX IF NOT EXISTS idx_system_metrics_name_timestamp ON public.system_metrics(metric_name, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_system_metrics_name_created ON public.system_metrics(metric_name, created_at DESC);

-- alert_logs 表索引
CREATE INDEX IF NOT EXISTS idx_alert_logs_type_created ON public.alert_logs(alert_type, created_at DESC);

-- cron_execution_log 表索引
CREATE INDEX IF NOT EXISTS idx_cron_execution_log_function_name ON public.cron_execution_log(function_name);
CREATE INDEX IF NOT EXISTS idx_cron_execution_log_executed_at ON public.cron_execution_log(executed_at DESC);

-- 创建自定义函数
-- ==============

-- 新用户处理函数
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email)
    VALUES (NEW.id, NEW.email);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 更新时间戳函数
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 获取有效应用名称函数
CREATE OR REPLACE FUNCTION public.get_effective_app_name(
    p_user_search_term text,
    p_selected_app_name text,
    p_app_name text
)
RETURNS text AS $$
BEGIN
    RETURN COALESCE(p_selected_app_name, p_user_search_term, p_app_name);
END;
$$ LANGUAGE plpgsql;

-- 启动下一批处理函数
CREATE OR REPLACE FUNCTION public.start_next_batch_processing(report_uuid uuid)
RETURNS void AS $$
DECLARE
    next_batch_id uuid;
BEGIN
    -- 查找下一个待处理的批次
    SELECT batch_id INTO next_batch_id
    FROM public.processing_queue
    WHERE report_id = report_uuid 
        AND status = 'queued'
    ORDER BY priority DESC, scheduled_at
    LIMIT 1;
    
    IF next_batch_id IS NOT NULL THEN
        -- 更新批次状态为处理中
        UPDATE public.processing_queue
        SET status = 'processing', started_at = now()
        WHERE batch_id = next_batch_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- 完成报告分析触发函数
CREATE OR REPLACE FUNCTION public.complete_report_analysis_trigger(report_uuid uuid)
RETURNS void AS $$
BEGIN
    -- 更新报告状态为完成
    UPDATE public.reports
    SET status = 'completed', completed_at = now(), analysis_completed_at = now()
    WHERE id = report_uuid;
END;
$$ LANGUAGE plpgsql;

-- 检查并启动下一批处理函数
CREATE OR REPLACE FUNCTION public.check_and_start_next_batch()
RETURNS TRIGGER AS $$
BEGIN
    -- 当分析任务完成时，检查是否可以启动下一批
    IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
        PERFORM public.start_next_batch_processing(NEW.report_id);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 分析表函数（用于性能监控）
CREATE OR REPLACE FUNCTION public.analyze_tables(table_names text[])
RETURNS text AS $$
DECLARE
    table_name text;
    result_text text := '';
BEGIN
    FOREACH table_name IN ARRAY table_names
    LOOP
        EXECUTE 'ANALYZE public.' || quote_ident(table_name);
        result_text := result_text || 'Analyzed table: ' || table_name || E'\n';
    END LOOP;
    
    RETURN result_text;
END;
$$ LANGUAGE plpgsql;

-- 创建触发器
-- ==========

-- 新用户触发器
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 更新时间戳触发器
DROP TRIGGER IF EXISTS update_reports_updated_at ON public.reports;
CREATE TRIGGER update_reports_updated_at
    BEFORE UPDATE ON public.reports
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_analysis_tasks_updated_at ON public.analysis_tasks;
CREATE TRIGGER update_analysis_tasks_updated_at
    BEFORE UPDATE ON public.analysis_tasks
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 分析任务完成触发器
DROP TRIGGER IF EXISTS check_next_batch_trigger ON public.analysis_tasks;
CREATE TRIGGER check_next_batch_trigger
    AFTER UPDATE ON public.analysis_tasks
    FOR EACH ROW EXECUTE FUNCTION public.check_and_start_next_batch();

-- 启用 RLS
-- ========
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suggestions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scraping_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scraped_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analysis_tasks ENABLE ROW LEVEL SECURITY;

-- 创建 RLS 政策
-- =============

-- users 表政策
DROP POLICY IF EXISTS "Users can read own profile" ON public.users;
CREATE POLICY "Users can read own profile" ON public.users
    FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
CREATE POLICY "Users can insert own profile" ON public.users
    FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
CREATE POLICY "Users can update own profile" ON public.users
    FOR UPDATE USING (auth.uid() = id);

-- reports 表政策
DROP POLICY IF EXISTS "Users can read own reports" ON public.reports;
CREATE POLICY "Users can read own reports" ON public.reports
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own reports" ON public.reports;
CREATE POLICY "Users can create own reports" ON public.reports
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own reports" ON public.reports;
CREATE POLICY "Users can update own reports" ON public.reports
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own reports" ON public.reports;
CREATE POLICY "Users can delete own reports" ON public.reports
    FOR DELETE USING (auth.uid() = user_id);

-- themes 表政策
DROP POLICY IF EXISTS "Users can read themes of own reports" ON public.themes;
CREATE POLICY "Users can read themes of own reports" ON public.themes
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.reports
            WHERE reports.id = themes.report_id AND reports.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can create themes for own reports" ON public.themes;
CREATE POLICY "Users can create themes for own reports" ON public.themes
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.reports
            WHERE reports.id = themes.report_id AND reports.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can update themes of own reports" ON public.themes;
CREATE POLICY "Users can update themes of own reports" ON public.themes
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.reports
            WHERE reports.id = themes.report_id AND reports.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can delete themes of own reports" ON public.themes;
CREATE POLICY "Users can delete themes of own reports" ON public.themes
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.reports
            WHERE reports.id = themes.report_id AND reports.user_id = auth.uid()
        )
    );

-- quotes 表政策
DROP POLICY IF EXISTS "Users can read quotes of own themes" ON public.quotes;
CREATE POLICY "Users can read quotes of own themes" ON public.quotes
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.themes
            JOIN public.reports ON reports.id = themes.report_id
            WHERE themes.id = quotes.theme_id AND reports.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can create quotes for own themes" ON public.quotes;
CREATE POLICY "Users can create quotes for own themes" ON public.quotes
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.themes
            JOIN public.reports ON reports.id = themes.report_id
            WHERE themes.id = quotes.theme_id AND reports.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can update quotes of own themes" ON public.quotes;
CREATE POLICY "Users can update quotes of own themes" ON public.quotes
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.themes
            JOIN public.reports ON reports.id = themes.report_id
            WHERE themes.id = quotes.theme_id AND reports.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can delete quotes of own themes" ON public.quotes;
CREATE POLICY "Users can delete quotes of own themes" ON public.quotes
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.themes
            JOIN public.reports ON reports.id = themes.report_id
            WHERE themes.id = quotes.theme_id AND reports.user_id = auth.uid()
        )
    );

-- suggestions 表政策
DROP POLICY IF EXISTS "Users can read suggestions of own themes" ON public.suggestions;
CREATE POLICY "Users can read suggestions of own themes" ON public.suggestions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.themes
            JOIN public.reports ON reports.id = themes.report_id
            WHERE themes.id = suggestions.theme_id AND reports.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can create suggestions for own themes" ON public.suggestions;
CREATE POLICY "Users can create suggestions for own themes" ON public.suggestions
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.themes
            JOIN public.reports ON reports.id = themes.report_id
            WHERE themes.id = suggestions.theme_id AND reports.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can update suggestions of own themes" ON public.suggestions;
CREATE POLICY "Users can update suggestions of own themes" ON public.suggestions
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.themes
            JOIN public.reports ON reports.id = themes.report_id
            WHERE themes.id = suggestions.theme_id AND reports.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can delete suggestions of own themes" ON public.suggestions;
CREATE POLICY "Users can delete suggestions of own themes" ON public.suggestions
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.themes
            JOIN public.reports ON reports.id = themes.report_id
            WHERE themes.id = suggestions.theme_id AND reports.user_id = auth.uid()
        )
    );

-- scraping_sessions 表政策
DROP POLICY IF EXISTS "Users can read own scraping sessions" ON public.scraping_sessions;
CREATE POLICY "Users can read own scraping sessions" ON public.scraping_sessions
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.reports
            WHERE reports.id = scraping_sessions.report_id AND reports.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can create scraping sessions for own reports" ON public.scraping_sessions;
CREATE POLICY "Users can create scraping sessions for own reports" ON public.scraping_sessions
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.reports
            WHERE reports.id = scraping_sessions.report_id AND reports.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can update own scraping sessions" ON public.scraping_sessions;
CREATE POLICY "Users can update own scraping sessions" ON public.scraping_sessions
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.reports
            WHERE reports.id = scraping_sessions.report_id AND reports.user_id = auth.uid()
        )
    );

-- scraped_reviews 表政策
DROP POLICY IF EXISTS "Users can read scraped reviews of own sessions" ON public.scraped_reviews;
CREATE POLICY "Users can read scraped reviews of own sessions" ON public.scraped_reviews
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.scraping_sessions
            JOIN public.reports ON reports.id = scraping_sessions.report_id
            WHERE scraping_sessions.id = scraped_reviews.scraping_session_id AND reports.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can create scraped reviews for own sessions" ON public.scraped_reviews;
CREATE POLICY "Users can create scraped reviews for own sessions" ON public.scraped_reviews
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.scraping_sessions
            JOIN public.reports ON reports.id = scraping_sessions.report_id
            WHERE scraping_sessions.id = scraped_reviews.scraping_session_id AND reports.user_id = auth.uid()
        )
    );

-- analysis_tasks 表政策
DROP POLICY IF EXISTS "Users can read own analysis tasks" ON public.analysis_tasks;
CREATE POLICY "Users can read own analysis tasks" ON public.analysis_tasks
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.reports
            WHERE reports.id = analysis_tasks.report_id AND reports.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can create analysis tasks for own reports" ON public.analysis_tasks;
CREATE POLICY "Users can create analysis tasks for own reports" ON public.analysis_tasks
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.reports
            WHERE reports.id = analysis_tasks.report_id AND reports.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can update own analysis tasks" ON public.analysis_tasks;
CREATE POLICY "Users can update own analysis tasks" ON public.analysis_tasks
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.reports
            WHERE reports.id = analysis_tasks.report_id AND reports.user_id = auth.uid()
        )
    );

-- 创建监控视图
-- ============

-- 系统概览视图
CREATE OR REPLACE VIEW public.system_overview AS
SELECT 
    'reports' as table_name,
    COUNT(*) as total_count,
    COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours') as last_24h,
    COUNT(*) FILTER (WHERE created_at > now() - interval '7 days') as last_7d
FROM public.reports
UNION ALL
SELECT 
    'analysis_tasks' as table_name,
    COUNT(*) as total_count,
    COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours') as last_24h,
    COUNT(*) FILTER (WHERE created_at > now() - interval '7 days') as last_7d
FROM public.analysis_tasks;

-- 报告状态统计视图
CREATE OR REPLACE VIEW public.report_status_stats AS
SELECT 
    status,
    COUNT(*) as count,
    ROUND(AVG(EXTRACT(epoch FROM (COALESCE(completed_at, now()) - created_at))/60), 2) as avg_duration_minutes
FROM public.reports
GROUP BY status;

-- 完成部署
-- ========
INSERT INTO public.system_metrics (metric_name, metric_value, metric_unit, tags)
VALUES ('deployment_completed', 1, 'boolean', json_build_object('timestamp', now()));

-- 部署完成通知
DO $$
BEGIN
    RAISE NOTICE '========================================';
    RAISE NOTICE 'ReviewInsight 数据库部署完成！';
    RAISE NOTICE '========================================';
    RAISE NOTICE '已创建组件：';
    RAISE NOTICE '✓ 数据库表：11 个核心业务表';
    RAISE NOTICE '✓ 索引：高性能查询优化索引';  
    RAISE NOTICE '✓ RLS 政策：行级安全访问控制';
    RAISE NOTICE '✓ 函数：业务逻辑处理函数';
    RAISE NOTICE '✓ 触发器：自动化数据处理';
    RAISE NOTICE '✓ 监控视图：系统状态监控';
    RAISE NOTICE '========================================';
END $$; 