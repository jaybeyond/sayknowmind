-- Daily AI usage tracking for free-tier rate limiting.
-- Users with their own API keys bypass this limit.

CREATE TABLE IF NOT EXISTS user_daily_usage (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  usage_date DATE NOT NULL DEFAULT CURRENT_DATE,
  ai_call_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_usage_date ON user_daily_usage(usage_date);
