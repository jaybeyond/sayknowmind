-- 064: Persist the EdgeQuake document_id alongside each SayKnowMind document.
--
-- Intent:
--   EdgeQuake generates its OWN random document_id on ingest (text_upload.rs);
--   the SayKnowMind id only travels in metadata.sayknowmind_document_id and was
--   never stored on the web side. That left no usable mapping to de-index a
--   document from EdgeQuake on delete/edit, so the shared RAG corpus accumulated
--   orphan vectors + graph nodes forever (dual-write non-contract).
--
--   This column stores the id EdgeQuake returns from POST /api/v1/documents so
--   delete/edit can call DELETE /api/v1/documents/{eq_document_id}.
--
-- Idempotency: ADD COLUMN IF NOT EXISTS + CREATE INDEX IF NOT EXISTS — safe to
--   re-run. The same DDL is self-healed at runtime (ensureEqDocumentIdColumn in
--   lib/ingest/document-store.ts) for no-migration deploys (Railway).
ALTER TABLE documents ADD COLUMN IF NOT EXISTS eq_document_id TEXT;
CREATE INDEX IF NOT EXISTS idx_documents_eq_document_id ON documents (eq_document_id);
