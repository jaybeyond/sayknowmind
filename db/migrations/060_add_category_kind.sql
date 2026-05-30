-- Collaborative docs, Phase 4 — type-scoped folder namespaces.
--
-- The sidebar now has three sibling folder trees: Collections, Documents, and
-- Mind maps. They all live in `categories` but must not share folders, so each
-- category carries a `kind` discriminator. Existing rows are Collections.
--
--   collection — general memory folders (the original behaviour)
--   doc        — folders that organize BlockNote documents
--   mindmap    — folders that organize mind maps
--
-- Children inherit their parent's kind at creation time (app layer), so the
-- column is only ever set on roots-and-down within one tree.

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'collection';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'categories_kind_check'
  ) THEN
    ALTER TABLE categories
      ADD CONSTRAINT categories_kind_check
      CHECK (kind IN ('collection', 'doc', 'mindmap'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_categories_kind ON categories (kind);
