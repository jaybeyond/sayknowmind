-- MCP audit log.
--
-- Every tool / resource call that comes through the MCP server with a
-- per-user API key gets one row here. The point is forensic — if a
-- user's key leaks (the key is effectively account-level credentials
-- the user pastes into Claude / Cursor / Gemini), they can see what
-- the key has been doing and decide whether to rotate.
--
-- Calls authenticated with the shared admin key (MCP_API_KEY env) are
-- *not* logged here — they don't belong to one user and would just
-- bloat the table.

CREATE TABLE IF NOT EXISTS mcp_audit_log (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  -- 'ok' on success, 'error' when the tool returned isError or threw,
  -- 'blocked' when the per-user isolation gate refused a workspace_*
  -- or graph tool call.
  status TEXT NOT NULL CHECK (status IN ('ok', 'error', 'blocked')),
  duration_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Single hot read path: "show me my recent activity, newest first."
CREATE INDEX IF NOT EXISTS idx_mcp_audit_log_user_created
  ON mcp_audit_log (user_id, created_at DESC);
