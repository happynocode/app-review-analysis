/*
  # Add Analysis Tasks for Asynchronous Processing

  1. New Tables
    - `analysis_tasks` - Store individual analysis batch tasks
      - `id` (uuid, primary key)
      - `report_id` (uuid, foreign key to reports)
      - `scraping_session_id` (uuid, foreign key to scraping_sessions)
      - `batch_index` (integer, batch number)
      - `status` (text, pending/processing/completed/failed)
      - `reviews_data` (jsonb, array of review texts for this batch)
      - `themes_data` (jsonb, DeepSeek analysis results)
      - `error_message` (text, error details if failed)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on analysis_tasks table
    - Add policies for authenticated users to manage their own analysis tasks

  3. Indexes
    - Add indexes for performance optimization
*/

-- Create analysis_tasks table
CREATE TABLE IF NOT EXISTS analysis_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  scraping_session_id uuid NOT NULL REFERENCES scraping_sessions(id) ON DELETE CASCADE,
  batch_index integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  reviews_data jsonb NOT NULL, -- Array of review texts for this batch
  themes_data jsonb, -- DeepSeek analysis results
  error_message text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE analysis_tasks ENABLE ROW LEVEL SECURITY;

-- RLS Policies for analysis_tasks
CREATE POLICY "Users can read own analysis tasks"
  ON analysis_tasks
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM reports 
      WHERE reports.id = analysis_tasks.report_id 
      AND reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create analysis tasks for own reports"
  ON analysis_tasks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM reports 
      WHERE reports.id = analysis_tasks.report_id 
      AND reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update own analysis tasks"
  ON analysis_tasks
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM reports 
      WHERE reports.id = analysis_tasks.report_id 
      AND reports.user_id = auth.uid()
    )
  );

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_analysis_tasks_report_id ON analysis_tasks(report_id);
CREATE INDEX IF NOT EXISTS idx_analysis_tasks_status ON analysis_tasks(status);
CREATE INDEX IF NOT EXISTS idx_analysis_tasks_scraping_session_id ON analysis_tasks(scraping_session_id);
CREATE INDEX IF NOT EXISTS idx_analysis_tasks_created_at ON analysis_tasks(created_at DESC);

-- Add updated_at trigger
CREATE TRIGGER update_analysis_tasks_updated_at
  BEFORE UPDATE ON analysis_tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();