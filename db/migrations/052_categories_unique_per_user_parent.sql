-- Unique (user_id, name, parent_id) per category so ON CONFLICT works.
--
-- The ingest job-queue and the MCP category_create tool both rely on
-- "find existing or insert new" semantics for collections, but the
-- categories table was missing the matching unique index. job-queue.ts
-- did `INSERT … ON CONFLICT (user_id, name, COALESCE(parent_id, …))`
-- which Postgres rejected with
--     "there is no unique or exclusion constraint matching the
--      ON CONFLICT specification"
-- — silently, inside a per-job try/catch — so AI-suggested collections
-- never landed and every user kept seeing an empty Collections panel.
--
-- We need to treat NULL parent_id as equal to itself (a user shouldn't
-- have two top-level collections named "AI"), which a plain
-- `UNIQUE (user_id, name, parent_id)` won't do because NULL != NULL.
-- Express that with COALESCE to the all-zeros sentinel UUID, matching
-- what the application-level code in
-- apps/web/lib/categories/store.ts already uses.

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_user_name_parent_unique
  ON categories (
    user_id,
    name,
    COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
