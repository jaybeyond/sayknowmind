-- Migration 044: add `locale` column to the better-auth "user" table
--
-- The web app (apps/web/app/api/user/me/route.ts) reads and writes a `locale`
-- column on "user", but no prior migration defined it. Valid values per app
-- code: 'en' | 'ko' | 'ja' | 'zh'. Stored as TEXT (no CHECK constraint so
-- future locales can be added without a schema change; app validates input).

SET search_path = public;

ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS locale TEXT;
