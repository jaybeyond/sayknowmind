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
  });
}

export const pool = globalForDb.pool ?? createPool();

globalForDb.pool = pool;
