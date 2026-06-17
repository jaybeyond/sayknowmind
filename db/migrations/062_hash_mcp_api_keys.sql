-- Stop storing MCP API keys in plaintext.
--
-- Before this, user_mcp_keys.api_key held the raw `sk-mcp-<hex>` token and
-- BOTH validators (apps/web lib/ingest/session-helper.ts and the mcp-server
-- packages/mcp-server/src/index.ts) compared the presented token against it
-- directly. A single read of this table leaked every user's live credential.
--
-- New model (backward compatible — existing keys keep working):
--   * api_key_hash — SHA-256(token) hex. Deterministic, so both validators do
--     an O(1) indexed lookup by hash. This is what auth checks now.
--   * api_key_enc  — token encrypted at rest (AES-256-GCM, per-user key via
--     apps/web/lib/encryption.ts) so the Settings → MCP tab can still re-display
--     the key to its owner without keeping plaintext on disk. The mcp-server
--     never needs this column (it only validates, via the hash).
--   * api_key      — legacy plaintext. Kept (NULLABLE now) so keys issued before
--     this migration still re-display. New keys are written with api_key = NULL.
--
-- Backfill: hash every existing plaintext key so it validates by hash on the
-- very next request. Requires pgcrypto for digest() (already present wherever
-- gen_random_uuid() is used; created here defensively).
--
-- FOLLOW-UP (not done here — needs the app's per-user encryption key, which is
-- not available in SQL): a one-time app-side job should encrypt each remaining
-- plaintext api_key into api_key_enc and then NULL the plaintext column, fully
-- removing legacy plaintext at rest. Until then, pre-migration keys retain
-- their plaintext (unchanged exposure); all NEW keys are plaintext-free.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE user_mcp_keys ADD COLUMN IF NOT EXISTS api_key_hash TEXT;
ALTER TABLE user_mcp_keys ADD COLUMN IF NOT EXISTS api_key_enc  TEXT;

-- Backfill hashes for existing plaintext keys (idempotent: only fills NULLs).
UPDATE user_mcp_keys
   SET api_key_hash = encode(digest(api_key, 'sha256'), 'hex')
 WHERE api_key_hash IS NULL
   AND api_key IS NOT NULL;

-- New keys store no plaintext, so api_key must be nullable.
ALTER TABLE user_mcp_keys ALTER COLUMN api_key DROP NOT NULL;

-- Auth lookups go through the hash; keep it unique (one key per hash).
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_mcp_keys_hash
  ON user_mcp_keys (api_key_hash);
