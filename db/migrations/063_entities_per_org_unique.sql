-- Fix the global entities-name collision (cross-user knowledge-graph corruption).
--
-- The relational `entities` table is created by EdgeQuake's init script with
-- `CONSTRAINT entities_unique_name UNIQUE NULLS NOT DISTINCT (tenant_id, workspace_id, name)`.
-- The web app is the ONLY writer of this table (EdgeQuake itself stores its graph
-- in Apache AGE nodes, never here — verified: no `INSERT INTO entities` in the Rust
-- crates). The web app inserts entities with tenant_id/workspace_id left NULL, so the
-- constraint collapses to "name is globally unique across every user": the second
-- user to ingest an entity named e.g. "OpenAI" hits ON CONFLICT and UPDATES the first
-- user's row instead of getting their own. document_id (COALESCE'd) stays pointing at
-- the first user's document, and metadata from different users gets merged together.
--
-- Fix: scope entity de-duplication to the owning ORGANISATION (the web app's team
-- pool), matching documents.organization_id. Because nothing else uses the old
-- constraint, we can safely drop it and replace it with a per-org partial unique index.
--
-- LIMITATION: rows already merged before this migration cannot be un-merged here (the
-- losing users' entities are gone). This stops all FUTURE collisions and correctly
-- scopes new ingestion; fully healing historical rows requires re-extraction.

ALTER TABLE entities ADD COLUMN IF NOT EXISTS organization_id TEXT;

-- Attribute each existing entity to its document's organisation.
UPDATE entities e
   SET organization_id = d.organization_id
  FROM documents d
 WHERE e.document_id = d.id
   AND e.organization_id IS NULL;

-- Drop the global name-uniqueness (web-app-only; EdgeQuake does not rely on it).
ALTER TABLE entities DROP CONSTRAINT IF EXISTS entities_unique_name;

-- De-dup per organisation instead. Rows with no organisation (orphans) are left
-- un-deduped rather than merged — that is the safe failure mode (duplicates, never
-- cross-tenant merges).
CREATE UNIQUE INDEX IF NOT EXISTS entities_org_name_unique
  ON entities (organization_id, name)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_entities_organization_id
  ON entities (organization_id);
