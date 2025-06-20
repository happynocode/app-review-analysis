/*
  # ReviewInsight Database Schema

  1. New Tables
    - `users` - User profiles (extends Supabase auth.users)
    - `reports` - Analysis reports for apps/companies
    - `themes` - Main themes identified in reports
    - `quotes` - User review quotes supporting each theme
    - `suggestions` - Product improvement suggestions for each theme

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users to manage their own data
    - Users can only access their own reports and related data

  3. Features
    - UUID primary keys with auto-generation
    - Timestamps for audit trails
    - Foreign key relationships for data integrity
    - Proper indexing for performance
*/

-- Create users table (extends auth.users)
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create reports table
CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'error')),
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

-- Create themes table
CREATE TABLE IF NOT EXISTS themes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create quotes table
CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_id uuid NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  text text NOT NULL,
  source text NOT NULL,
  review_date date NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Create suggestions table
CREATE TABLE IF NOT EXISTS suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_id uuid NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  text text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE themes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE suggestions ENABLE ROW LEVEL SECURITY;

-- Users policies
CREATE POLICY "Users can read own profile"
  ON users
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON users
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON users
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Reports policies
CREATE POLICY "Users can read own reports"
  ON reports
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own reports"
  ON reports
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reports"
  ON reports
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own reports"
  ON reports
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Themes policies
CREATE POLICY "Users can read themes of own reports"
  ON themes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM reports 
      WHERE reports.id = themes.report_id 
      AND reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create themes for own reports"
  ON themes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM reports 
      WHERE reports.id = themes.report_id 
      AND reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update themes of own reports"
  ON themes
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM reports 
      WHERE reports.id = themes.report_id 
      AND reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete themes of own reports"
  ON themes
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM reports 
      WHERE reports.id = themes.report_id 
      AND reports.user_id = auth.uid()
    )
  );

-- Quotes policies
CREATE POLICY "Users can read quotes of own themes"
  ON quotes
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM themes 
      JOIN reports ON reports.id = themes.report_id
      WHERE themes.id = quotes.theme_id 
      AND reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create quotes for own themes"
  ON quotes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM themes 
      JOIN reports ON reports.id = themes.report_id
      WHERE themes.id = quotes.theme_id 
      AND reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update quotes of own themes"
  ON quotes
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM themes 
      JOIN reports ON reports.id = themes.report_id
      WHERE themes.id = quotes.theme_id 
      AND reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete quotes of own themes"
  ON quotes
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM themes 
      JOIN reports ON reports.id = themes.report_id
      WHERE themes.id = quotes.theme_id 
      AND reports.user_id = auth.uid()
    )
  );

-- Suggestions policies
CREATE POLICY "Users can read suggestions of own themes"
  ON suggestions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM themes 
      JOIN reports ON reports.id = themes.report_id
      WHERE themes.id = suggestions.theme_id 
      AND reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create suggestions for own themes"
  ON suggestions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM themes 
      JOIN reports ON reports.id = themes.report_id
      WHERE themes.id = suggestions.theme_id 
      AND reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update suggestions of own themes"
  ON suggestions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM themes 
      JOIN reports ON reports.id = themes.report_id
      WHERE themes.id = suggestions.theme_id 
      AND reports.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete suggestions of own themes"
  ON suggestions
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM themes 
      JOIN reports ON reports.id = themes.report_id
      WHERE themes.id = suggestions.theme_id 
      AND reports.user_id = auth.uid()
    )
  );

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_reports_user_id ON reports(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_themes_report_id ON themes(report_id);
CREATE INDEX IF NOT EXISTS idx_quotes_theme_id ON quotes(theme_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_theme_id ON suggestions(theme_id);

-- Create function to automatically create user profile
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.users (id, email)
  VALUES (new.id, new.email);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to automatically create user profile on signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reports_updated_at
  BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();