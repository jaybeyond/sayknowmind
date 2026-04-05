-- Migration 040: Fix rateLimit table for better-auth v1.5.6
-- better-auth 1.5.6 expects an "id" column on the rateLimit table.
-- Previous versions used "key" as the primary key.

ALTER TABLE "rateLimit" ADD COLUMN IF NOT EXISTS id TEXT;
UPDATE "rateLimit" SET id = key WHERE id IS NULL;
