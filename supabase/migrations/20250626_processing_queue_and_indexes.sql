/*
  # Processing Queue and Performance Indexes

  1. New Table
    - `processing_queue` - Manage parallel analysis task queue

  2. Performance Indexes
    - Add optimized indexes for parallel processing
    - Improve query performance for analysis tasks
    - Optimize queue management queries

  3. Security
    - Enable RLS on processing_queue table
    - Add policies for authenticated users
*/

-- Create processing_queue table for parallel batch management
CREATE TABLE IF NOT EXISTS processing_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  batch_id uuid NOT NULL REFERENCES analysis_tasks(id) ON DELETE CASCADE,
  priority integer DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'retrying')),
  retry_count integer DEFAULT 0 CHECK (retry_count >= 0),
  max_retries integer DEFAULT 3 CHECK (max_retries >= 0),
  scheduled_at timestamptz DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  error_details jsonb,
  estimated_duration_seconds integer,
  actual_duration_seconds integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE processing_queue ENABLE ROW LEVEL SECURITY;

-- RLS Policies for processing_queue
CREATE POLICY "Users can read own processing queue"
  ON processing_queue
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM reports 
      WHERE reports.id = processing_queue.report_id 
      AND reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create processing queue for own reports"
  ON processing_queue
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM reports 
      WHERE reports.id = processing_queue.report_id 
      AND reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own processing queue"
  ON processing_queue
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM reports 
      WHERE reports.id = processing_queue.report_id 
      AND reports.user_id = auth.uid()
    )
  );

-- Performance indexes for queue management
CREATE INDEX IF NOT EXISTS idx_processing_queue_status_priority 
  ON processing_queue(status, priority DESC, scheduled_at ASC);

CREATE INDEX IF NOT EXISTS idx_processing_queue_report_id 
  ON processing_queue(report_id);

CREATE INDEX IF NOT EXISTS idx_processing_queue_batch_id 
  ON processing_queue(batch_id);

CREATE INDEX IF NOT EXISTS idx_processing_queue_scheduled 
  ON processing_queue(scheduled_at ASC) 
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_processing_queue_processing 
  ON processing_queue(started_at DESC) 
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS idx_processing_queue_retry 
  ON processing_queue(retry_count, created_at DESC) 
  WHERE status = 'failed' AND retry_count < max_retries;

-- Optimize existing analysis_tasks table indexes
CREATE INDEX IF NOT EXISTS idx_analysis_tasks_status_priority 
  ON analysis_tasks(status, batch_index) 
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_analysis_tasks_report_processing 
  ON analysis_tasks(report_id, status, created_at DESC) 
  WHERE status IN ('pending', 'processing', 'failed');

-- Optimize reports table for monitoring queries
CREATE INDEX IF NOT EXISTS idx_reports_processing_status 
  ON reports(status, created_at DESC) 
  WHERE status IN ('processing', 'pending');

-- Optimize scraping_sessions for faster lookups
CREATE INDEX IF NOT EXISTS idx_scraping_sessions_report_status 
  ON scraping_sessions(report_id, status) 
  WHERE status IN ('running', 'completed');

-- Add constraint to ensure logical timestamps for processing_queue
ALTER TABLE processing_queue ADD CONSTRAINT check_queue_timestamps 
  CHECK (
    (started_at IS NULL OR started_at >= scheduled_at) AND
    (completed_at IS NULL OR (started_at IS NOT NULL AND completed_at >= started_at))
  );

-- Add updated_at trigger for processing_queue
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_processing_queue_updated_at
  BEFORE UPDATE ON processing_queue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add index for cleanup and monitoring
CREATE INDEX IF NOT EXISTS idx_processing_queue_cleanup 
  ON processing_queue(created_at DESC) 
  WHERE status IN ('completed', 'failed');

-- Add partial index for active queue monitoring
CREATE INDEX IF NOT EXISTS idx_processing_queue_active 
  ON processing_queue(report_id, status, priority DESC) 
  WHERE status IN ('queued', 'processing', 'retrying'); 