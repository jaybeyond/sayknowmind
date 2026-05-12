-- Migration 043: web-app compatibility columns for `documents`
--
-- The `documents` table is shared between EdgeQuake (multi-tenant schema with
-- tenant_id / workspace_id) and the web app (user-scoped schema with user_id).
-- EdgeQuake creates the table first via its own migration system, causing
-- 04-sayknowmind-init.sql's CREATE TABLE IF NOT EXISTS to skip. As a result
-- the web-app columns are missing in production. This migration adds them
-- so both systems can coexist on a single table.
--
-- Columns are NULL-allowed (existing EdgeQuake rows have no concept of them).
-- New rows inserted by the web app populate them explicitly.

SET search_path = public;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS user_id      TEXT,
  ADD COLUMN IF NOT EXISTS summary      TEXT,
  ADD COLUMN IF NOT EXISTS url          TEXT,
  ADD COLUMN IF NOT EXISTS source_type  VARCHAR(50),
  ADD COLUMN IF NOT EXISTS indexed_at   TIMESTAMP;

-- FK to better-auth "user". Guarded so the migration stays idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documents_user_id_fkey'
  ) THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_documents_user_id     ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_source_type ON documents(source_type);
