-- Migration: Add unique constraint on (workspace_id, sha256_checksum) for pdf_documents
--
-- FIX-DUPLICATE-BUG: Prevents TOCTOU race condition where two concurrent uploads
-- of the same PDF file both pass the application-level duplicate check
-- (find_pdf_by_checksum) before either inserts, creating duplicate records.
--
-- The previous idx_pdf_documents_checksum was a plain index (not unique), providing
-- no concurrency protection. This migration replaces it with a unique index that
-- acts as a database-level constraint.
--
-- NOTE: The unique constraint is scoped to (workspace_id, sha256_checksum) because
-- the same PDF file uploaded to different workspaces should be allowed.

-- Drop the old non-unique index
DROP INDEX IF EXISTS idx_pdf_documents_checksum CASCADE;

-- Create unique index for workspace-scoped deduplication
-- WHY: Enforces that the same PDF (by SHA-256 checksum) can only exist once
-- per workspace, regardless of how many concurrent upload requests arrive.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pdf_documents_workspace_checksum_unique
    ON pdf_documents(workspace_id, sha256_checksum);
