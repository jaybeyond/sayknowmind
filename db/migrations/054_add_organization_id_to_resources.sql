-- Team feature, Phase 2 — attach `organization_id` to core resource tables.
--
-- Phase 1 (053) gave every user a personal organization. This migration
-- makes the user's knowledge belong to an organization instead of only to
-- a user, which is what lets teammates share a pool.
--
-- Scope: the six tables the web app scopes by `user_id TEXT`:
--     documents, categories, tags, conversations, ingestion_jobs, shared_content
-- Child/junction tables (document_categories, document_tags,
-- document_relations, messages, vectors) inherit scope through their parent
-- FK and deliberately get NO column of their own.
--
-- Personal/per-user tables are intentionally EXCLUDED — they are not team
-- data: notifications, user_mcp_keys, user_integration_tokens/_imports,
-- user_daily_usage, channel_links.
--
-- This migration is ADDITIVE and reversible:
--   * `organization_id` is added NULLABLE — no NOT NULL, no constraint drops.
--   * No existing column or query semantics change. Application code still
--     reads `user_id`; Phase 3 switches isolation over to membership.
--   * Rollback = `ALTER TABLE ... DROP COLUMN organization_id` on each table.
--
-- Backfill maps each row to the personal org of its owner via the
-- deterministic slug `personal-<user_id>` minted in 053. Rows whose user_id
-- has no personal org (orphans / NULL) keep organization_id NULL.

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'documents', 'categories', 'tags',
    'conversations', 'ingestion_jobs', 'shared_content'
  ]
  LOOP
    -- 1. add the nullable, cascade-on-delete column
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS organization_id TEXT '
      'REFERENCES organization(id) ON DELETE CASCADE', tbl);

    -- 2. backfill: row -> personal org of its owner
    EXECUTE format(
      'UPDATE %I t SET organization_id = o.id '
      'FROM organization o '
      'WHERE o.slug = ''personal-'' || t.user_id '
      '  AND t.organization_id IS NULL', tbl);

    -- 3. index for org-scoped lookups
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS idx_%s_organization_id '
      'ON %I (organization_id)', tbl, tbl);
  END LOOP;
END $$;
