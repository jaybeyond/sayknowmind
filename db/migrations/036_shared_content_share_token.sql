-- Migration: Add share_token for URL-friendly share links
ALTER TABLE shared_content
  ADD COLUMN IF NOT EXISTS share_token VARCHAR(32) UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', '');

-- Backfill existing rows
UPDATE shared_content SET share_token = replace(gen_random_uuid()::text, '-', '') WHERE share_token IS NULL;

-- Make NOT NULL after backfill
ALTER TABLE shared_content ALTER COLUMN share_token SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shared_content_share_token ON shared_content(share_token);
