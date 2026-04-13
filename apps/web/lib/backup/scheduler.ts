/**
 * Automated Backup System
 *
 * Provides periodic PostgreSQL snapshots with configurable retention.
 * Backups are stored as SQL dumps in the configured backup directory.
 */

import { pool } from "@/lib/db";
import { writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync } from "fs";
import { join } from "path";

const BACKUP_DIR = process.env.BACKUP_DIR ?? "./backups";
const BACKUP_RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS ?? "7", 10);
const BACKUP_INTERVAL_MS = parseInt(process.env.BACKUP_INTERVAL_MS ?? "86400000", 10); // 24h default

export interface BackupResult {
  filename: string;
  path: string;
  sizeBytes: number;
  tablesIncluded: string[];
  createdAt: string;
  durationMs: number;
}

export interface BackupStatus {
  lastBackup: BackupResult | null;
  nextBackupAt: string;
  backupCount: number;
  totalSizeBytes: number;
}

// Tables to include in backup
const BACKUP_TABLES = [
  "documents",
  "entities",
  "categories",
  "document_categories",
  "conversations",
  "messages",
  "shared_content",
  "ingestion_jobs",
];

/**
 * Create a logical backup by exporting table data as JSON.
 */
export async function createBackup(): Promise<BackupResult> {
  const start = Date.now();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `backup-${timestamp}.json`;

  mkdirSync(BACKUP_DIR, { recursive: true });

  const backup: Record<string, unknown[]> = {};
  const tablesIncluded: string[] = [];

  for (const table of BACKUP_TABLES) {
    try {
      // Use identifier quoting to prevent SQL injection — table names are from BACKUP_TABLES whitelist
      const result = await pool.query(`SELECT * FROM "${table}"`);
      backup[table] = result.rows;
      tablesIncluded.push(table);
    } catch {
      // Table may not exist yet — skip
    }
  }

  // Add metadata
  const data = {
    version: "0.1.0",
    createdAt: new Date().toISOString(),
    tables: backup,
  };

  const filePath = join(BACKUP_DIR, filename);
  const content = JSON.stringify(data);
  writeFileSync(filePath, content, "utf-8");

  const stats = statSync(filePath);

  return {
    filename,
    path: filePath,
    sizeBytes: stats.size,
    tablesIncluded,
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - start,
  };
}

/**
 * Restore from a backup file.
 */
export async function restoreBackup(filePath: string): Promise<{
  success: boolean;
  tablesRestored: string[];
  rowsRestored: number;
}> {
  const { readFileSync } = await import("fs");
  const content = readFileSync(filePath, "utf-8");
  const data = JSON.parse(content);
  const tables = data.tables as Record<string, unknown[]>;

  let totalRows = 0;
  const tablesRestored: string[] = [];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const [table, rows] of Object.entries(tables)) {
      if (!BACKUP_TABLES.includes(table) || rows.length === 0) continue;

      // Get column names from first row — validate against alphanumeric+underscore only
      const columns = Object.keys(rows[0] as Record<string, unknown>);
      const colPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
      if (!columns.every((c) => colPattern.test(c))) {
        throw new Error(`Invalid column names in backup data for table ${table}`);
      }

      const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
      const columnList = columns.map((c) => `"${c}"`).join(", ");

      for (const row of rows) {
        const values = columns.map((c) => (row as Record<string, unknown>)[c]);
        try {
          await client.query(
            `INSERT INTO "${table}" (${columnList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
            values,
          );
          totalRows++;
        } catch { /* skip conflicting rows */ }
      }
      tablesRestored.push(table);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return { success: true, tablesRestored, rowsRestored: totalRows };
}

/**
 * Clean up old backups beyond retention period.
 */
export function cleanOldBackups(): number {
  try {
    const files = readdirSync(BACKUP_DIR);
    const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 86_400_000;
    let removed = 0;

    for (const file of files) {
      if (!file.startsWith("backup-") || !file.endsWith(".json")) continue;
      const filePath = join(BACKUP_DIR, file);
      try {
        const stats = statSync(filePath);
        if (stats.mtimeMs < cutoff) {
          unlinkSync(filePath);
          removed++;
        }
      } catch { /* skip */ }
    }

    return removed;
  } catch {
    return 0;
  }
}

/**
 * Get backup status summary.
 */
export function getBackupStatus(): BackupStatus {
  try {
    mkdirSync(BACKUP_DIR, { recursive: true });
    const files = readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith("backup-") && f.endsWith(".json"))
      .sort()
      .reverse();

    let totalSize = 0;
    let lastBackup: BackupResult | null = null;

    for (const file of files) {
      const filePath = join(BACKUP_DIR, file);
      const stats = statSync(filePath);
      totalSize += stats.size;

      if (!lastBackup) {
        lastBackup = {
          filename: file,
          path: filePath,
          sizeBytes: stats.size,
          tablesIncluded: BACKUP_TABLES,
          createdAt: stats.mtime.toISOString(),
          durationMs: 0,
        };
      }
    }

    const lastTime = lastBackup ? new Date(lastBackup.createdAt).getTime() : 0;
    const nextBackupAt = new Date(lastTime + BACKUP_INTERVAL_MS).toISOString();

    return {
      lastBackup,
      nextBackupAt,
      backupCount: files.length,
      totalSizeBytes: totalSize,
    };
  } catch {
    return {
      lastBackup: null,
      nextBackupAt: new Date(Date.now() + BACKUP_INTERVAL_MS).toISOString(),
      backupCount: 0,
      totalSizeBytes: 0,
    };
  }
}
