-- Migration 002: YouTube Quota, User Daily Limits, and Publish Jobs

CREATE TABLE IF NOT EXISTS youtube_app_quota (
  date_key TEXT PRIMARY KEY,
  units_used INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS youtube_user_quota (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  uploads_count INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_quota_lookup ON youtube_user_quota(user_id, date_key);

CREATE TABLE IF NOT EXISTS publish_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  clip_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata_json TEXT,
  result_url TEXT,
  error TEXT,
  scheduled_for TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY(clip_id) REFERENCES clips(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_publish_jobs_user_id ON publish_jobs(user_id);
CREATE INDEX IF NOT EXISTS idx_publish_jobs_status ON publish_jobs(status);

-- Add publishing columns to clips
ALTER TABLE clips ADD COLUMN youtube_url TEXT;
ALTER TABLE clips ADD COLUMN publish_status TEXT;
ALTER TABLE clips ADD COLUMN published_at TEXT;
