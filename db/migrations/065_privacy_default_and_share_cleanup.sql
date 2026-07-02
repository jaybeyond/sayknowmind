-- 065: Privacy-by-default flip + resource_team_shares orphan cleanup.
--
-- DB-10: Flip privacy default back to 'private'.
--   Migration 055 set `privacy_level` to default 'shared' on `documents` and
--   `categories` (opt-out model). This violates privacy-by-default: newly created
--   resources should be owner-only until the user explicitly shares them.
--
--   This change affects ONLY new inserts. Existing rows keep their current
--   privacy_level untouched — silently exposing a user's existing private content
--   the moment they join a team would be wrong.
--
-- DB-8: resource_team_shares orphan-row cleanup (trigger).
--   Migration 058 created `resource_team_shares` with `resource_id` typed as UUID
--   for a polymorphic target (documents.id OR categories.id). A foreign key cannot
--   reference two parent tables, so no FK was added there. As a result, deleting a
--   document or category leaves orphan rows in resource_team_shares (share rows
--   referencing a resource that no longer exists).
--
--   `organization_id` and `granted_by` already carry ON DELETE CASCADE FKs from
--   migration 058, so those columns are clean.
--
--   The fix is a pair of triggers that fire AFTER DELETE on `documents` and
--   `categories`, purging any resource_team_shares rows that referenced the
--   deleted resource. The same triggers also clean up `resource_shares` (the
--   per-user ACL table created in migration 056, which has the same polymorphic
--   resource_id pattern and the same orphan problem).
--
-- Idempotency: all DDL uses IF NOT EXISTS / guarded DO $$ blocks; safe to
-- re-run.

-- ---------------------------------------------------------------------------
-- DB-10: Flip column default to 'private'
-- ---------------------------------------------------------------------------

ALTER TABLE documents  ALTER COLUMN privacy_level SET DEFAULT 'private';
ALTER TABLE categories ALTER COLUMN privacy_level SET DEFAULT 'private';

-- ---------------------------------------------------------------------------
-- DB-8: Triggers to clean up polymorphic share rows on resource deletion
-- ---------------------------------------------------------------------------

-- Shared cleanup function: removes rows from both share tables for
-- the deleted resource. Called by both document and category after-delete
-- triggers. `resource_type_val` is the CHECK-constrained value used in the
-- share tables ('document' or 'category').
CREATE OR REPLACE FUNCTION fn_cleanup_resource_shares()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_resource_type TEXT;
BEGIN
  -- Determine polymorphic type label from the triggering table.
  IF TG_TABLE_NAME = 'documents' THEN
    v_resource_type := 'document';
  ELSIF TG_TABLE_NAME = 'categories' THEN
    v_resource_type := 'category';
  ELSE
    -- Unknown table — do nothing rather than deleting wrong rows.
    RETURN OLD;
  END IF;

  -- Remove per-user ACL grants (resource_shares, migration 056).
  DELETE FROM resource_shares
  WHERE resource_type = v_resource_type
    AND resource_id   = OLD.id;

  -- Remove team-share grants (resource_team_shares, migration 058).
  DELETE FROM resource_team_shares
  WHERE resource_type = v_resource_type
    AND resource_id   = OLD.id;

  RETURN OLD;
END;
$$;

-- Trigger on documents.
DROP TRIGGER IF EXISTS trg_documents_cleanup_shares ON documents;
CREATE TRIGGER trg_documents_cleanup_shares
  AFTER DELETE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION fn_cleanup_resource_shares();

-- Trigger on categories.
DROP TRIGGER IF EXISTS trg_categories_cleanup_shares ON categories;
CREATE TRIGGER trg_categories_cleanup_shares
  AFTER DELETE ON categories
  FOR EACH ROW
  EXECUTE FUNCTION fn_cleanup_resource_shares();

-- ---------------------------------------------------------------------------
-- Back-fill: remove already-orphaned share rows
-- (resources deleted before this migration was applied)
-- ---------------------------------------------------------------------------

-- Orphans in resource_shares
DELETE FROM resource_shares rs
WHERE rs.resource_type = 'document'
  AND NOT EXISTS (
    SELECT 1 FROM documents d WHERE d.id = rs.resource_id
  );

DELETE FROM resource_shares rs
WHERE rs.resource_type = 'category'
  AND NOT EXISTS (
    SELECT 1 FROM categories c WHERE c.id = rs.resource_id
  );

-- Orphans in resource_team_shares
DELETE FROM resource_team_shares rts
WHERE rts.resource_type = 'document'
  AND NOT EXISTS (
    SELECT 1 FROM documents d WHERE d.id = rts.resource_id
  );

DELETE FROM resource_team_shares rts
WHERE rts.resource_type = 'category'
  AND NOT EXISTS (
    SELECT 1 FROM categories c WHERE c.id = rts.resource_id
  );
