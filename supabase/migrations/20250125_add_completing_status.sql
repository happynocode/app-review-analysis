-- Add 'completing' status to reports table to prevent duplicate processing
-- This migration adds the 'completing' status to the reports table status check constraint

-- Drop the existing constraint
ALTER TABLE public.reports DROP CONSTRAINT IF EXISTS reports_status_check;

-- Add the new constraint with 'completing' status
ALTER TABLE public.reports ADD CONSTRAINT reports_status_check 
CHECK (status IN ('pending', 'processing', 'completed', 'error', 'scraping', 'analyzing', 'scraping_completed', 'failed', 'completing'));

-- Add comment explaining the new status
COMMENT ON COLUMN public.reports.status IS 'Report processing status. "completing" is used to prevent duplicate final processing.';
