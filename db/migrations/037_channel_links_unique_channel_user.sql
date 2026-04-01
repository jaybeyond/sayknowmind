-- Prevent one Telegram user from being linked to multiple web accounts.
-- The old constraint UNIQUE(user_id, channel) only prevented one user from having
-- two Telegram links, but allowed the SAME Telegram ID to link to many accounts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_links_unique_channel_user
  ON channel_links (channel, channel_user_id)
  WHERE channel_user_id IS NOT NULL;
