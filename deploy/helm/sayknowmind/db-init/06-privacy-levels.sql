-- SayknowMind v0.1.0 - Per-document and per-category privacy levels
-- Adds privacy_level column to documents and categories tables.
-- Default: 'private' (backward-compatible — existing rows stay private)

-- Documents privacy level
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS privacy_level VARCHAR(10) NOT NULL DEFAULT 'private'
  CHECK (privacy_level IN ('private', 'shared'));

CREATE INDEX IF NOT EXISTS idx_documents_privacy_level ON documents(privacy_level);

-- Categories privacy level
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS privacy_level VARCHAR(10) NOT NULL DEFAULT 'private'
  CHECK (privacy_level IN ('private', 'shared'));

CREATE INDEX IF NOT EXISTS idx_categories_privacy_level ON categories(privacy_level);
