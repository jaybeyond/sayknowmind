import { Pool } from "pg";

// ---------------------------------------------------------------------------
// PostgreSQL connection pool (singleton)
// ---------------------------------------------------------------------------

const globalForDb = globalThis as unknown as { pool: Pool | undefined };

export const pool =
  globalForDb.pool ??
  new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      `postgres://${process.env.POSTGRES_USER ?? "postgres"}:${process.env.POSTGRES_PASSWORD ?? "changeme-in-production"}@localhost:${process.env.POSTGRES_PORT ?? "5432"}/sayknowmind`,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.pool = pool;
}
