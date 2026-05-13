-- Migration: 049_web_graph_schema_compat.sql
-- Description: Keep the web knowledge graph/ingestion paths compatible with
-- the EdgeQuake entities table shape used by production.

-- Web ingestion and knowledge graph routes expect per-document entity columns.
-- EdgeQuake creates entities with source_ids/entity_type; add compatible
-- columns instead of replacing the EdgeQuake shape.
ALTER TABLE entities
  ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS confidence FLOAT NOT NULL DEFAULT 0.8,
  ADD COLUMN IF NOT EXISTS properties JSONB DEFAULT '{}'::jsonb;

UPDATE entities
SET type = entity_type
WHERE type IS NULL AND entity_type IS NOT NULL;

UPDATE entities
SET document_id = source_ids[1]
WHERE document_id IS NULL
  AND source_ids IS NOT NULL
  AND array_length(source_ids, 1) > 0;

UPDATE entities
SET properties = COALESCE(properties, '{}'::jsonb) || COALESCE(metadata, '{}'::jsonb)
WHERE metadata IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_entities_document_id ON entities(document_id);
CREATE INDEX IF NOT EXISTS idx_entities_document_type ON entities(document_id, type);
