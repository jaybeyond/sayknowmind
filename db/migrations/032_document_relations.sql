-- Document-to-document similarity relations (auto-linked by pipeline)
CREATE TABLE IF NOT EXISTS document_relations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  related_document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  score REAL NOT NULL DEFAULT 0,
  relation_type VARCHAR(50) NOT NULL DEFAULT 'similar',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(document_id, related_document_id)
);

CREATE INDEX IF NOT EXISTS idx_document_relations_doc ON document_relations(document_id);
CREATE INDEX IF NOT EXISTS idx_document_relations_related ON document_relations(related_document_id);

-- Migrate existing metadata.tags → metadata.aiTags for AI-generated tags
UPDATE documents
SET metadata = (metadata - 'tags') || jsonb_build_object('aiTags', metadata->'tags')
WHERE metadata ? 'tags' AND NOT metadata ? 'aiTags';
