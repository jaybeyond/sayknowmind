-- Migration: 028_channel_links.sql
-- Generalize telegram_links to support multiple channels (Telegram, Slack, Discord, Email)

CREATE TABLE IF NOT EXISTS channel_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  channel VARCHAR(20) NOT NULL,
  channel_user_id TEXT,
  channel_username TEXT,
  link_code TEXT,
  linked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT channel_links_unique UNIQUE (user_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_channel_links_user ON channel_links(user_id);
CREATE INDEX IF NOT EXISTS idx_channel_links_channel_user ON channel_links(channel, channel_user_id);
CREATE INDEX IF NOT EXISTS idx_channel_links_code ON channel_links(link_code) WHERE link_code IS NOT NULL;

-- Migrate existing telegram_links data
INSERT INTO channel_links (user_id, channel, channel_user_id, channel_username, link_code, linked_at, created_at)
SELECT user_id, 'telegram', telegram_user_id::text, telegram_username, link_code, linked_at, created_at
FROM telegram_links
ON CONFLICT (user_id, channel) DO NOTHING;
