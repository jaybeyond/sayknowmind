-- Migration: 030_add_lang_to_channel_links.sql
-- Add language preference column for Telegram bot i18n.
-- Default 'en' — user selects via /lang command.

ALTER TABLE channel_links ADD COLUMN IF NOT EXISTS lang VARCHAR(5) DEFAULT 'en';
