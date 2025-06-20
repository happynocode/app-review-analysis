/*
  # 添加抓取数据存储表

  1. 新增表
    - `scraped_reviews` - 存储从各平台抓取的评论数据
    - `scraping_sessions` - 记录每次抓取会话的元数据
  
  2. 安全性
    - 启用所有表的RLS
    - 添加用户访问策略
  
  3. 索引
    - 为查询优化添加必要索引
*/

-- 抓取会话表
CREATE TABLE IF NOT EXISTS scraping_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  app_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'error')),
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
  platform text NOT NULL CHECK (platform IN ('app_store', 'google_play', 'reddit')),
  review_text text NOT NULL,
  rating integer,
  review_date date,
  author_name text,
  source_url text,
  additional_data jsonb, -- 存储平台特定的额外数据
  created_at timestamptz DEFAULT now()
);

-- 启用RLS
ALTER TABLE scraping_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraped_reviews ENABLE ROW LEVEL SECURITY;

-- 抓取会话的RLS策略
CREATE POLICY "Users can read own scraping sessions"
  ON scraping_sessions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM reports 
      WHERE reports.id = scraping_sessions.report_id 
      AND reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create scraping sessions for own reports"
  ON scraping_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM reports 
      WHERE reports.id = scraping_sessions.report_id 
      AND reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own scraping sessions"
  ON scraping_sessions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM reports 
      WHERE reports.id = scraping_sessions.report_id 
      AND reports.user_id = auth.uid()
    )
  );

-- 抓取评论的RLS策略
CREATE POLICY "Users can read scraped reviews of own sessions"
  ON scraped_reviews
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM scraping_sessions 
      JOIN reports ON reports.id = scraping_sessions.report_id
      WHERE scraping_sessions.id = scraped_reviews.scraping_session_id 
      AND reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create scraped reviews for own sessions"
  ON scraped_reviews
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM scraping_sessions 
      JOIN reports ON reports.id = scraping_sessions.report_id
      WHERE scraping_sessions.id = scraped_reviews.scraping_session_id 
      AND reports.user_id = auth.uid()
    )
  );

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_scraping_sessions_report_id ON scraping_sessions(report_id);
CREATE INDEX IF NOT EXISTS idx_scraping_sessions_status ON scraping_sessions(status);
CREATE INDEX IF NOT EXISTS idx_scraped_reviews_session_id ON scraped_reviews(scraping_session_id);
CREATE INDEX IF NOT EXISTS idx_scraped_reviews_platform ON scraped_reviews(platform);
CREATE INDEX IF NOT EXISTS idx_scraped_reviews_created_at ON scraped_reviews(created_at DESC);