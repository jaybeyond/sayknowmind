-- Migration: 047_telegram_processed_updates.sql
-- Description: Idempotency receipts for Telegram webhook updates.
--
-- Telegram retries webhook deliveries when a handler times out or fails.
-- The bot must process each (bot, update_id) once so an offline local AI
-- relay cannot cause duplicate "AI unavailable" replies.

CREATE TABLE IF NOT EXISTS telegram_processed_updates (
  bot_id TEXT NOT NULL,
  update_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (bot_id, update_id)
);

CREATE INDEX IF NOT EXISTS idx_telegram_processed_updates_created_at
  ON telegram_processed_updates (created_at DESC);
