/**
 * PGlite adapter — embedded PostgreSQL for desktop mode.
 * Provides the same pool.query() / pool.connect() interface as pg.Pool
 * so all existing API routes work unchanged.
 */

import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { join } from "path";
import { readFileSync, existsSync } from "fs";

// Store data in user's app data directory
function getDataDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? ".";
  const platform = process.platform;
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "com.sayknowmind.desktop", "pglite");
  } else if (platform === "win32") {
    return join(process.env.APPDATA ?? home, "SayknowMind", "pglite");
  }
  return join(home, ".sayknowmind", "pglite");
}

let pgliteInstance: PGlite | null = null;
let initialized = false;

async function getInstance(): Promise<PGlite> {
  if (pgliteInstance) return pgliteInstance;

  const dataDir = getDataDir();
  console.log(`[pglite] Data directory: ${dataDir}`);

  pgliteInstance = new PGlite(dataDir, {
    extensions: { vector },
  });

  await pgliteInstance.waitReady;

  // Run init SQL on first launch
  if (!initialized) {
    await initSchema(pgliteInstance);
    initialized = true;
  }

  return pgliteInstance;
}

async function initSchema(db: PGlite): Promise<void> {
  // Check if schema already exists
  const check = await db.query(
    `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'documents') AS "exists"`
  );
  if ((check.rows[0] as Record<string, unknown>)?.exists) {
    console.log("[pglite] Schema already initialized");
    return;
  }

  console.log("[pglite] Initializing schema...");

  // Load and execute desktop init SQL
  const initPath = join(process.cwd(), "desktop-init.sql");
  if (existsSync(initPath)) {
    const sql = readFileSync(initPath, "utf-8");
    await db.exec(sql);
    console.log("[pglite] Schema initialized from desktop-init.sql");
  } else {
    console.error("[pglite] desktop-init.sql not found at", initPath);
  }

  // Auto-create local user for desktop mode
  await db.exec(`
    INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
    VALUES ('local-desktop-user', 'Local User', 'local@desktop', true, NOW(), NOW())
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO session (id, "userId", token, "expiresAt", "createdAt", "updatedAt", "ipAddress", "userAgent")
    VALUES (
      'local-desktop-session',
      'local-desktop-user',
      'local-desktop-token',
      NOW() + INTERVAL '100 years',
      NOW(), NOW(),
      '127.0.0.1',
      'SayknowMind Desktop'
    )
    ON CONFLICT (id) DO NOTHING;
  `);
  console.log("[pglite] Local desktop user created");
}

// ---------------------------------------------------------------------------
// Pool-compatible interface
// ---------------------------------------------------------------------------

type QueryResult = {
  rows: any[];
  rowCount: number | null;
  fields?: any[];
};

class PGliteClient {
  private db: PGlite;

  constructor(db: PGlite) {
    this.db = db;
  }

  async query(text: string, params?: unknown[]): Promise<QueryResult> {
    const result = await this.db.query(text, params as any[]);
    return {
      rows: result.rows as any[],
      rowCount: result.affectedRows ?? result.rows.length,
      fields: result.fields,
    };
  }

  release(): void {
    // No-op for PGlite (single connection)
  }
}

export class PGlitePool {
  async query(text: string, params?: unknown[]): Promise<QueryResult> {
    const db = await getInstance();
    const result = await db.query(text, params as any[]);
    return {
      rows: result.rows as any[],
      rowCount: result.affectedRows ?? result.rows.length,
      fields: result.fields,
    };
  }

  async connect(): Promise<PGliteClient> {
    const db = await getInstance();
    return new PGliteClient(db);
  }

  async end(): Promise<void> {
    if (pgliteInstance) {
      await pgliteInstance.close();
      pgliteInstance = null;
      initialized = false;
    }
  }
}
