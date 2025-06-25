-- 修复reports表的状态约束，添加'completing'状态
-- 这个状态用于防止complete-report-analysis的并发执行

-- 删除现有的状态约束
ALTER TABLE public.reports 
DROP CONSTRAINT IF EXISTS reports_status_check;

-- 添加包含'completing'状态的新约束
ALTER TABLE public.reports 
ADD CONSTRAINT reports_status_check 
CHECK (status IN (
  'pending', 
  'scraping', 
  'scraping_completed', 
  'analyzing', 
  'completing',  -- 新增的中间状态
  'completed', 
  'failed', 
  'error'
));

-- 添加注释说明各状态的含义
COMMENT ON COLUMN public.reports.status IS '
报告状态流转：
- pending: 初始状态，等待开始处理
- scraping: 正在爬取数据
- scraping_completed: 爬取完成，等待分析
- analyzing: 正在进行AI分析
- completing: 正在完成报告生成（防并发锁定状态）
- completed: 报告生成完成
- failed: 处理失败
- error: 系统错误
';
