-- Version history for editable documents (notes, sheets, mindmaps).
-- Every content save funnels through PATCH /api/documents/:id, which captures a
-- throttled checkpoint here, attributed to the user who triggered it. Restoring
-- writes the snapshot back onto the live document.
CREATE TABLE IF NOT EXISTS document_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  title       text,
  content     text,
  metadata    jsonb,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- List newest-first per document; also drives the retention prune.
CREATE INDEX IF NOT EXISTS idx_document_versions_doc_time
  ON document_versions (document_id, created_at DESC);
