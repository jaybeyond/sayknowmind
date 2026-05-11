-- SayknowMind v0.1.0 — Per-user cloud connector OAuth tokens
--
-- Each row is one (user, provider, account) tuple. A user may connect multiple
-- accounts of the same provider (e.g. two Google accounts), so the unique key
-- includes account_id from the provider side.
--
-- Tokens are stored encrypted with AES-256-GCM keyed by ENCRYPTION_KEY
-- (matches the existing per-user data encryption scheme). The CIPHERTEXT
-- and IV are stored separately so the same key/IV pair never repeats —
-- generate a fresh IV on every write.
--
-- Cascade-delete on user removal keeps cleanup automatic.

CREATE TABLE IF NOT EXISTS user_integration_tokens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  provider        VARCHAR(64) NOT NULL,        -- 'google-drive', 'notion', 'dropbox', 'github', ...
  account_id      VARCHAR(255) NOT NULL,       -- provider-side stable ID (e.g. Google sub)
  account_email   TEXT,                        -- displayed in UI; nullable for providers without email
  account_label   TEXT,                        -- optional friendly name set by user
  scope           TEXT,                        -- space-separated list of granted scopes
  access_token    TEXT NOT NULL,               -- AES-256-GCM ciphertext (base64)
  access_iv       TEXT NOT NULL,               -- IV for access_token (base64)
  access_tag      TEXT NOT NULL,               -- auth tag for access_token (base64)
  refresh_token   TEXT,                        -- AES-256-GCM ciphertext, nullable
  refresh_iv      TEXT,                        -- IV for refresh_token, nullable
  refresh_tag     TEXT,                        -- auth tag for refresh_token, nullable
  expires_at      TIMESTAMPTZ,                 -- access_token expiry; nullable for non-expiring
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- provider-specific extras (e.g. team_id)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider, account_id)
);

CREATE INDEX IF NOT EXISTS idx_user_integration_tokens_user_provider
  ON user_integration_tokens(user_id, provider);

CREATE INDEX IF NOT EXISTS idx_user_integration_tokens_expires
  ON user_integration_tokens(expires_at)
  WHERE expires_at IS NOT NULL;

-- updated_at trigger
CREATE OR REPLACE FUNCTION fn_user_integration_tokens_touch()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_integration_tokens_touch ON user_integration_tokens;
CREATE TRIGGER trg_user_integration_tokens_touch
  BEFORE UPDATE ON user_integration_tokens
  FOR EACH ROW
  EXECUTE FUNCTION fn_user_integration_tokens_touch();

-- ---------------------------------------------------------------------------
-- Per-user import history. Records every file imported from a connector so
-- that re-imports can be detected and surfaced to the user (de-duplication).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_integration_imports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  provider        VARCHAR(64) NOT NULL,
  account_id      VARCHAR(255) NOT NULL,
  external_id     TEXT NOT NULL,               -- file ID at the provider (Google Drive fileId, Notion page ID...)
  external_url    TEXT,                        -- canonical URL at the provider
  document_id     UUID REFERENCES documents(id) ON DELETE SET NULL,  -- ingested doc, set NULL if user deletes
  imported_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  external_modified_at TIMESTAMPTZ,            -- modifiedTime from provider (for change detection)
  UNIQUE (user_id, provider, account_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_user_integration_imports_user
  ON user_integration_imports(user_id, provider, account_id);
