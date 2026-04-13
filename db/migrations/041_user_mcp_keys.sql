-- User MCP API keys for MCP server authentication
CREATE TABLE IF NOT EXISTS user_mcp_keys (
    user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
    api_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_mcp_keys_api_key ON user_mcp_keys(api_key);
