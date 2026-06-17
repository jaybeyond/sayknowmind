import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pool } from "@/lib/db";
import { randomBytes, createHash } from "crypto";
import { encryptForUser, decryptForUser } from "@/lib/encryption";

// Keys are stored hashed (validation) + encrypted (re-display), never plaintext.
// See migration 062. ensureTable doubles as the schema guard for envs that
// don't run migrations.
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_mcp_keys (
      user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
      api_key TEXT UNIQUE,
      api_key_hash TEXT,
      api_key_enc TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE user_mcp_keys ADD COLUMN IF NOT EXISTS api_key_hash TEXT`);
  await pool.query(`ALTER TABLE user_mcp_keys ADD COLUMN IF NOT EXISTS api_key_enc TEXT`);
  await pool.query(`ALTER TABLE user_mcp_keys ALTER COLUMN api_key DROP NOT NULL`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_user_mcp_keys_hash ON user_mcp_keys(api_key_hash)`);
  // Best-effort backfill for legacy plaintext rows (no-op if pgcrypto missing
  // or migration 062 already ran).
  await pool
    .query(
      `UPDATE user_mcp_keys SET api_key_hash = encode(digest(api_key, 'sha256'), 'hex')
       WHERE api_key_hash IS NULL AND api_key IS NOT NULL`,
    )
    .catch(() => {});
}

function hashApiKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** POST /api/user/mcp-key — Generate a new MCP API key for the current user */
export async function POST() {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureTable();

  const apiKey = `sk-mcp-${randomBytes(32).toString("hex")}`;
  const apiKeyHash = hashApiKey(apiKey);
  const apiKeyEnc = encryptForUser(userId, apiKey);

  // Store hash (for validation) + encrypted copy (for re-display). No plaintext.
  await pool.query(
    `INSERT INTO user_mcp_keys (user_id, api_key, api_key_hash, api_key_enc, created_at)
     VALUES ($1, NULL, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET api_key = NULL, api_key_hash = $2, api_key_enc = $3, created_at = NOW()`,
    [userId, apiKeyHash, apiKeyEnc],
  );

  return NextResponse.json({ apiKey });
}

/** GET /api/user/mcp-key — Get current MCP API key (decrypted for its owner) */
export async function GET() {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await ensureTable();

  const result = await pool.query(
    `SELECT api_key, api_key_enc FROM user_mcp_keys WHERE user_id = $1`,
    [userId],
  );
  const row = result.rows[0] as
    | { api_key?: string | null; api_key_enc?: string | null }
    | undefined;

  let apiKey: string | null = null;
  if (row?.api_key_enc) {
    try {
      apiKey = decryptForUser(userId, row.api_key_enc);
    } catch {
      apiKey = null;
    }
  } else if (row?.api_key) {
    // Legacy key issued before migration 062 — still plaintext, still shown.
    apiKey = row.api_key;
  }

  return NextResponse.json({ apiKey });
}
