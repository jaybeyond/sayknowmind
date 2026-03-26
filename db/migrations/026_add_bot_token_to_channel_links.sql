-- Migration: 026_add_bot_token_to_channel_links.sql
-- Add missing bot_token, bot_name, bot_username columns to channel_links.
-- These are required by the integrations API to store per-user bot credentials.

ALTER TABLE channel_links ADD COLUMN IF NOT EXISTS bot_token TEXT;
ALTER TABLE channel_links ADD COLUMN IF NOT EXISTS bot_name TEXT;
ALTER TABLE channel_links ADD COLUMN IF NOT EXISTS bot_username TEXT;
