-- Migration: Add encryption_method and expires_at columns to shared_content
-- Required by the new IPFS Kubo + age encryption shared mode implementation

ALTER TABLE shared_content
  ADD COLUMN IF NOT EXISTS encryption_method VARCHAR(50),
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;

-- Index for expiry-based cleanup queries
CREATE INDEX IF NOT EXISTS idx_shared_content_expires_at
  ON shared_content(expires_at)
  WHERE expires_at IS NOT NULL;
