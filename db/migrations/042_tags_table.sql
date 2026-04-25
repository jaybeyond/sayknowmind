-- 042: Dedicated tags table with canonical deduplication
-- Replaces JSONB metadata.aiTags with normalized, indexed tag system

-- Tags master table (per-user, canonical uniqueness)
CREATE TABLE IF NOT EXISTS tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, canonical_name)
);

CREATE INDEX IF NOT EXISTS tags_user_id_idx ON tags(user_id);
CREATE INDEX IF NOT EXISTS tags_canonical_idx ON tags(user_id, canonical_name);

-- Junction table: document ↔ tag (many-to-many)
CREATE TABLE IF NOT EXISTS document_tags (
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, tag_id)
);

CREATE INDEX IF NOT EXISTS document_tags_doc_idx ON document_tags(document_id);
CREATE INDEX IF NOT EXISTS document_tags_tag_idx ON document_tags(tag_id);

-- Migrate existing aiTags from metadata JSONB to new tables
-- This inserts unique tags per user and links them to documents
DO $$
DECLARE
  doc RECORD;
  tag_text TEXT;
  tag_canonical TEXT;
  tag_uuid UUID;
BEGIN
  FOR doc IN
    SELECT id, user_id, metadata->'aiTags' AS ai_tags
    FROM documents
    WHERE metadata->'aiTags' IS NOT NULL
      AND jsonb_array_length(metadata->'aiTags') > 0
  LOOP
    FOR tag_text IN SELECT jsonb_array_elements_text(doc.ai_tags)
    LOOP
      tag_canonical := lower(trim(tag_text));
      IF tag_canonical = '' THEN CONTINUE; END IF;

      -- Upsert tag
      INSERT INTO tags (user_id, name, canonical_name)
      VALUES (doc.user_id, trim(tag_text), tag_canonical)
      ON CONFLICT (user_id, canonical_name) DO UPDATE SET name = tags.name
      RETURNING id INTO tag_uuid;

      -- Link to document
      INSERT INTO document_tags (document_id, tag_id)
      VALUES (doc.id, tag_uuid)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;
