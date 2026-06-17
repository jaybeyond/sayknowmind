-- Fix the global entities-name collision (cross-user knowledge-graph corruption).
--
-- The relational `entities` table is web-app-owned (EdgeQuake stores its graph in
-- Apache AGE, never here). On the EdgeQuake-first schema its only uniqueness was
-- `UNIQUE (tenant_id, workspace_id, name)`, which — because the web app leaves
-- tenant_id/workspace_id NULL — collapsed to "name is globally unique across every
-- user", so the 2nd user to ingest an entity name UPDATEd the 1st user's row
-- (cross-user merge/corruption). On the sayknowmind-first schema there was no
-- uniqueness at all and duplicate names already exist.
--
-- Fix: scope entity de-duplication to the owning ORGANISATION.
--
-- IMPORTANT: we do NOT add a UNIQUE (organization_id, name) index. Real databases
-- already contain duplicate (organization_id, name) rows (verified against a live
-- DB — older schemas never enforced name uniqueness), so a unique index would fail
-- to build, and de-duplicating in SQL would mean destructively deleting entities
-- and cascade-deleting their `relationships` edges. Instead, per-org de-dup is done
-- at the application layer (apps/web/lib/ingest/document-store.ts `insertEntities`:
-- find-by-(org,name)-then-update-else-insert, and NEVER merge when the org is NULL
-- so org-less rows can't re-introduce the cross-user collision). This migration only
-- adds the column + a NON-unique lookup index and drops the old global constraint.
--
-- Historical rows already merged before this migration cannot be un-merged here.

-- Wrapped in a transaction so the column add / backfill / constraint drop / index
-- creation either all land or none do (migrate.sh runs psql without
-- --single-transaction, and some runners use ON_ERROR_STOP=0).
BEGIN;

ALTER TABLE entities ADD COLUMN IF NOT EXISTS organization_id TEXT;

-- Attribute each existing entity to its document's organisation.
UPDATE entities e
   SET organization_id = d.organization_id
  FROM documents d
 WHERE e.document_id = d.id
   AND e.organization_id IS NULL;

-- Drop the global name-uniqueness (web-app-only; EdgeQuake does not rely on it).
ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_unique_name;

-- Non-unique lookup index backing the app-layer per-org de-dup query.
CREATE INDEX IF NOT EXISTS idx_entities_org_name
  ON entities (organization_id, name);

CREATE INDEX IF NOT EXISTS idx_entities_organization_id
  ON entities (organization_id);

COMMIT;
