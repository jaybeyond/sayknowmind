// ---------------------------------------------------------------------------
// PostgreSQL connection pool (singleton)
// Desktop mode: PGlite (embedded PostgreSQL)
// Cloud mode: pg Pool (remote PostgreSQL)
// ---------------------------------------------------------------------------

const globalForDb = globalThis as unknown as { pool: any | undefined };

function createPool() {
  if (process.env.PGLITE_MODE === "true") {
    const { PGlitePool } = require("@/lib/db-pglite");
    return new PGlitePool();
  }

  // Dynamic import — pg has native bindings that can't be bundled by Turbopack
  const { Pool } = require("pg");
  return new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      `postgres://${process.env.POSTGRES_USER ?? "postgres"}:${process.env.POSTGRES_PASSWORD ?? "changeme-in-production"}@localhost:${process.env.POSTGRES_PORT ?? "5432"}/sayknowmind`,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    // Bound the wait for a free connection so connection pressure surfaces as a
    // fast, retriable error instead of a permanent hang (pg's default is 0 =
    // wait forever). Defensive backstop for pool-starvation regressions.
    connectionTimeoutMillis: Number(process.env.PG_POOL_CONNECTION_TIMEOUT_MS ?? 10_000),
  });
}

export const pool = globalForDb.pool ?? createPool();

globalForDb.pool = pool;

// ---------------------------------------------------------------------------
// RLS-scoped connection (migration 066 backstop).
//
// Runs `fn` inside a transaction whose `app.current_org_id` GUC is set, so the
// org_isolation RLS policies scope every query to `orgId`. This is the per-
// request plumbing the RLS cutover requires: once the app connects as the
// non-superuser `sayknowmind_app` role, all org-scoped reads/writes MUST go
// through here (or RLS fails them closed). Under the current superuser pool the
// GUC is harmless (superuser bypasses RLS), so adopting this incrementally is
// safe before the cutover. Not used in PGLITE/desktop single-user mode.
// ---------------------------------------------------------------------------
export async function withOrgRls<T>(
  orgId: string,
  fn: (client: { query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // SET LOCAL (transaction-scoped) via set_config so the GUC never leaks to
    // the next request that reuses this pooled connection.
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
