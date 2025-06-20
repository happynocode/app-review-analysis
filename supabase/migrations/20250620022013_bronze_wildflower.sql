/*
  # Add time period tracking to reports

  1. Changes
    - Add `time_period` column to reports table
    - Add `scraped_date_range` column to track actual date range of scraped reviews
    - Update existing reports to have default time period

  2. Security
    - No changes to RLS policies needed
*/

-- Add time period column to reports table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reports' AND column_name = 'time_period'
  ) THEN
    ALTER TABLE reports ADD COLUMN time_period text DEFAULT '1_month';
  END IF;
END $$;

-- Add scraped date range tracking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'reports' AND column_name = 'scraped_date_range'
  ) THEN
    ALTER TABLE reports ADD COLUMN scraped_date_range jsonb;
  END IF;
END $$;

-- Add check constraint for time_period
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'reports' AND constraint_name = 'reports_time_period_check'
  ) THEN
    ALTER TABLE reports ADD CONSTRAINT reports_time_period_check 
    CHECK (time_period IN ('1_week', '1_month', '3_months', 'all'));
  END IF;
END $$;

-- Update existing reports to have default time period
UPDATE reports 
SET time_period = '1_month' 
WHERE time_period IS NULL;