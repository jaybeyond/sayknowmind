/**
 * Document version history.
 *
 * Notes, sheets and mindmaps all persist through PATCH /api/documents/:id, so a
 * single capture point here checkpoints every editable surface. Capture is
 * throttled (one checkpoint per active editing window) and retained to a cap so
 * the table can't grow without bound.
 */
import { pool } from "@/lib/db";
import type { Queryable } from "@/lib/tags/store";

/** Minimum gap between two automatic checkpoints of the same document. */
const THROTTLE_MS = 30_000;
/** Keep at most this many versions per document (oldest pruned). */
const MAX_VERSIONS = 50;

/**
 * Snapshot the current state of a document into its version history.
 *
 * Reads the just-saved row (so the snapshot reflects merged metadata, not just
 * the PATCH delta) and inserts a checkpoint attributed to `userId`. Best-effort:
 * callers should not let a versioning failure break the save.
 *
 * @param force  skip the throttle (used before a restore overwrites state).
 * @returns the new version id, or null when throttled / nothing to snapshot.
 */
export async function captureDocumentVersion(
  documentId: string,
  userId: string,
  opts: { force?: boolean; db?: Queryable } = {},
): Promise<string | null> {
  const db = opts.db ?? pool;

  if (!opts.force) {
    const recent = await db.query(
      `SELECT 1 FROM document_versions
        WHERE document_id = $1 AND created_at > NOW() - ($2::int * INTERVAL '1 millisecond')
        LIMIT 1`,
      [documentId, THROTTLE_MS],
    );
    if (recent.rows.length > 0) return null;
  }

  const cur = await db.query(
    `SELECT title, content, metadata FROM documents WHERE id = $1`,
    [documentId],
  );
  if (cur.rows.length === 0) return null;
  const row = cur.rows[0];

  // Skip if the newest checkpoint already holds identical content+title — no
  // point recording a version that changed nothing. (`force` still de-dups; a
  // restore to the current state is a no-op worth skipping too.)
  const last = await db.query(
    `SELECT title, content FROM document_versions
      WHERE document_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [documentId],
  );
  if (
    last.rows.length > 0 &&
    (last.rows[0].title ?? null) === (row.title ?? null) &&
    (last.rows[0].content ?? null) === (row.content ?? null)
  ) {
    return null;
  }

  const inserted = await db.query(
    `INSERT INTO document_versions (document_id, title, content, metadata, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [documentId, row.title ?? null, row.content ?? null, row.metadata ?? null, userId],
  );

  // Retain only the newest MAX_VERSIONS checkpoints.
  await db.query(
    `DELETE FROM document_versions
      WHERE document_id = $1
        AND id NOT IN (
          SELECT id FROM document_versions
           WHERE document_id = $1
           ORDER BY created_at DESC, id DESC
           LIMIT $2
        )`,
    [documentId, MAX_VERSIONS],
  );

  return inserted.rows[0].id as string;
}
