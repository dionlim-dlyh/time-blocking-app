-- Run this in your Supabase project's SQL editor
-- Dashboard -> SQL Editor -> New Query -> paste this -> Run

CREATE TABLE daily_plans (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date         DATE NOT NULL,
  domain       TEXT NOT NULL,
  start_time   TEXT NOT NULL,
  end_time     TEXT NOT NULL,
  focus        TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE(date, domain)
);

CREATE TABLE day_logs (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date          DATE NOT NULL,
  domain        TEXT NOT NULL,
  actual_hours  NUMERIC(4,2),
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(date, domain)
);

ALTER TABLE daily_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE day_logs    ENABLE ROW LEVEL SECURITY;

-- Personal app: allow full access with the anon key
CREATE POLICY "allow_all" ON daily_plans FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all" ON day_logs    FOR ALL USING (true) WITH CHECK (true);
