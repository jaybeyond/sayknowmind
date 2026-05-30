-- Collaborative docs, Phase 2 — real-time collaboration persistence.
--
-- While a doc is open for live editing the Yjs CRDT is the source of truth.
-- Hocuspocus (packages/relay-server) loads/stores the merged Yjs state through
-- onLoadDocument / onStoreDocument. This table is that store: one row per
-- document holding the full encoded Yjs state (`Y.encodeStateAsUpdate`).
--
-- The at-rest projection for search/graph/memory still lives in
-- `documents.content` (plaintext) + `documents.metadata.blocknote` (block JSON),
-- written by the client's debounced autosave. This table never feeds search —
-- it only lets a reconnecting collaborator resume the exact CRDT history.
--
-- `document_id` is the PK and FK: the Yjs state is meaningless without its
-- document, and is dropped when the document is deleted.

CREATE TABLE IF NOT EXISTS doc_collab (
  document_id  UUID PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  state        BYTEA NOT NULL,
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW()
);
