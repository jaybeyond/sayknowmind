import Cap from "@cap.js/server";
import { pool } from "@/lib/db";

// ---------------------------------------------------------------------------
// Cap CAPTCHA server instance — PostgreSQL-backed storage
// Tables are created automatically on first use.
// ---------------------------------------------------------------------------

interface ChallengeData {
  challenge: { c: number; s: number; d: number };
  expires: number;
}

// Ensure tables exist (idempotent)
let schemaInitialized = false;
async function ensureSchema(): Promise<void> {
  if (schemaInitialized) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cap_challenges (
      token      TEXT    PRIMARY KEY,
      data       JSONB   NOT NULL,
      expires_at BIGINT  NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cap_tokens (
      token      TEXT    PRIMARY KEY,
      expires_at BIGINT  NOT NULL
    );
  `);
  schemaInitialized = true;
}

export const cap = new Cap({
  noFSState: true,
  tokens_store_path: "",
  state: { challengesList: {}, tokensList: {} },
  storage: {
    challenges: {
      store: async (token: string, data: ChallengeData) => {
        await ensureSchema();
        await pool.query(
          `INSERT INTO cap_challenges (token, data, expires_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (token) DO UPDATE SET data = $2, expires_at = $3`,
          [token, JSON.stringify(data), data.expires],
        );
      },
      read: async (token: string) => {
        await ensureSchema();
        const result = await pool.query(
          `SELECT data FROM cap_challenges WHERE token = $1`,
          [token],
        );
        return (result.rows[0] as { data: ChallengeData } | undefined)?.data ?? null;
      },
      delete: async (token: string) => {
        await pool.query(`DELETE FROM cap_challenges WHERE token = $1`, [token]);
      },
      deleteExpired: async () => {
        await pool.query(
          `DELETE FROM cap_challenges WHERE expires_at < $1`,
          [Date.now()],
        );
      },
    },
    tokens: {
      store: async (token: string, expiresAt: number) => {
        await ensureSchema();
        await pool.query(
          `INSERT INTO cap_tokens (token, expires_at)
           VALUES ($1, $2)
           ON CONFLICT (token) DO UPDATE SET expires_at = $2`,
          [token, expiresAt],
        );
      },
      get: async (token: string) => {
        await ensureSchema();
        const result = await pool.query(
          `SELECT expires_at FROM cap_tokens WHERE token = $1`,
          [token],
        );
        if (result.rows.length === 0) return null;
        return Number((result.rows[0] as { expires_at: string }).expires_at);
      },
      delete: async (token: string) => {
        await pool.query(`DELETE FROM cap_tokens WHERE token = $1`, [token]);
      },
      deleteExpired: async () => {
        await pool.query(
          `DELETE FROM cap_tokens WHERE expires_at < $1`,
          [Date.now()],
        );
      },
    },
  },
});
