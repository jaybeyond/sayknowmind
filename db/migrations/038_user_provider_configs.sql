-- Per-user provider configuration with AES-256-GCM encrypted API keys.
-- Replaces the global .sayknowmind-providers.json file approach.

CREATE TABLE IF NOT EXISTS user_provider_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  provider_id VARCHAR(50) NOT NULL,
  encrypted_api_key TEXT NOT NULL,
  model VARCHAR(200) NOT NULL DEFAULT '',
  base_url VARCHAR(500) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  extra_fields JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT upc_user_provider UNIQUE (user_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_upc_user ON user_provider_configs(user_id);
