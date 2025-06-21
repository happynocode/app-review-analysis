-- 简化架构迁移：删除processing_queue表，优化analysis_tasks表
-- 创建时间: 2025-01-XX
-- 描述: 实施架构简化，移除冗余的队列系统

-- 1. 删除processing_queue表（如果存在）
DROP TABLE IF EXISTS processing_queue CASCADE;

-- 2. 确保analysis_tasks表有所有必需的字段
-- 添加缺失的字段（如果不存在）
DO $$ 
BEGIN
    -- 检查并添加sentiment_data字段
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'analysis_tasks' AND column_name = 'sentiment_data'
    ) THEN
        ALTER TABLE analysis_tasks ADD COLUMN sentiment_data jsonb;
    END IF;

    -- 检查并添加keywords_data字段
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'analysis_tasks' AND column_name = 'keywords_data'
    ) THEN
        ALTER TABLE analysis_tasks ADD COLUMN keywords_data jsonb;
    END IF;

    -- 检查并添加issues_data字段
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'analysis_tasks' AND column_name = 'issues_data'
    ) THEN
        ALTER TABLE analysis_tasks ADD COLUMN issues_data jsonb;
    END IF;

    -- 检查并添加error_message字段
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'analysis_tasks' AND column_name = 'error_message'
    ) THEN
        ALTER TABLE analysis_tasks ADD COLUMN error_message text;
    END IF;
END $$;

-- 3. 更新analysis_tasks表的索引以优化查询性能
CREATE INDEX IF NOT EXISTS idx_analysis_tasks_report_status 
ON analysis_tasks(report_id, status);

CREATE INDEX IF NOT EXISTS idx_analysis_tasks_batch_priority 
ON analysis_tasks(batch_index, priority DESC);

CREATE INDEX IF NOT EXISTS idx_analysis_tasks_type_status 
ON analysis_tasks(analysis_type, status);

-- 4. 添加注释说明简化后的架构
COMMENT ON TABLE analysis_tasks IS '分析任务表 - 简化架构后的唯一任务管理表';
COMMENT ON COLUMN analysis_tasks.sentiment_data IS '情感分析结果数据';
COMMENT ON COLUMN analysis_tasks.keywords_data IS '关键词分析结果数据';
COMMENT ON COLUMN analysis_tasks.issues_data IS '问题分析结果数据';
COMMENT ON COLUMN analysis_tasks.themes_data IS '主题分析结果数据';
COMMENT ON COLUMN analysis_tasks.error_message IS '任务失败时的错误信息';

-- 5. 清理可能残留的队列相关数据
-- 删除任何可能存在的队列相关触发器或函数
DROP TRIGGER IF EXISTS update_processing_queue_updated_at ON processing_queue;
DROP FUNCTION IF EXISTS update_processing_queue_updated_at();

-- 6. 确保reports表有analysis_started_at字段
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'reports' AND column_name = 'analysis_started_at'
    ) THEN
        ALTER TABLE reports ADD COLUMN analysis_started_at timestamptz;
    END IF;
END $$;

COMMENT ON COLUMN reports.analysis_started_at IS '分析开始时间';

-- 7. 优化system_metrics表索引（如果存在）
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_name = 'system_metrics'
    ) THEN
        CREATE INDEX IF NOT EXISTS idx_system_metrics_name_created 
        ON system_metrics(metric_name, created_at DESC);
    END IF;
END $$; 