-- Scope Telegram user links by bot token.
--
-- A Telegram sender id is only unique inside the routing context of a bot.
-- SayKnowMind lets each web user save their own bot token, so the same
-- Telegram account must be able to talk to multiple user-owned bots without
-- one account stealing another user's link. Pending verification rows are not
-- real account links and must not participate in uniqueness checks.

-- Remove stale verification-code rows. Active rows expire after 10 minutes in
-- the application flow, so keeping older rows only causes false "already
-- linked" states and uniqueness conflicts.
DELETE FROM channel_links
WHERE channel = 'telegram'
  AND user_id LIKE 'pending:%'
  AND linked_at < NOW() - INTERVAL '10 minutes';

-- Old behavior: one Telegram sender id could exist only once globally.
-- New behavior: one sender id can be linked once per Telegram bot.
DROP INDEX IF EXISTS idx_channel_links_unique_channel_user;

CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_links_unique_channel_bot_user
  ON channel_links (channel, bot_token, channel_user_id)
  WHERE channel_user_id IS NOT NULL
    AND bot_token IS NOT NULL
    AND user_id NOT LIKE 'pending:%';

-- Preserve one-account-only semantics for legacy/shared-env bots where rows do
-- not carry a saved bot_token.
CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_links_unique_channel_user_no_bot
  ON channel_links (channel, channel_user_id)
  WHERE channel_user_id IS NOT NULL
    AND bot_token IS NULL
    AND user_id NOT LIKE 'pending:%';

