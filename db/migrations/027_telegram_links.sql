-- Telegram Bot Integration: user account linking
CREATE TABLE IF NOT EXISTS telegram_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  telegram_user_id BIGINT UNIQUE,
  telegram_username TEXT,
  link_code TEXT UNIQUE,
  linked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_telegram_user UNIQUE (user_id)
);

CREATE INDEX idx_telegram_links_user_id ON telegram_links(user_id);
CREATE INDEX idx_telegram_links_telegram_user_id ON telegram_links(telegram_user_id);
CREATE INDEX idx_telegram_links_link_code ON telegram_links(link_code) WHERE link_code IS NOT NULL;
