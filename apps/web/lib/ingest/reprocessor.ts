import { pool } from "@/lib/db";
import { createJob } from "./job-queue";

interface StaleDoc {
  id: string;
  user_id: string;
  title: string;
  reason: string;
}

/**
 * Find documents that need reprocessing and queue them.
 * Called periodically or via API.
 */
export async function runReprocessor(opts?: { limit?: number }): Promise<{
  queued: number;
  documents: Array<{ id: string; title: string; reason: string }>;
}> {
  const limit = opts?.limit ?? 20;
  const staleDocs: StaleDoc[] = [];

  // 1. Documents with no summary (older than 1 hour — give initial processing time)
  const noSummary = await pool.query(
    `SELECT id, user_id, title FROM documents
     WHERE (metadata->>'summary' IS NULL OR metadata->>'summary' = '')
       AND created_at < NOW() - INTERVAL '1 hour'
     ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  for (const row of noSummary.rows) {
    staleDocs.push({ id: row.id, user_id: row.user_id, title: row.title, reason: "no_summary" });
  }

  // 2. Documents with content but not indexed in EdgeQuake
  const remaining = limit - staleDocs.length;
  if (remaining > 0) {
    const existingIds = staleDocs.map((d) => d.id);
    const notIndexed = await pool.query(
      `SELECT id, user_id, title FROM documents
       WHERE indexed_at IS NULL
         AND content IS NOT NULL AND content != ''
         AND created_at < NOW() - INTERVAL '1 hour'
         ${existingIds.length > 0 ? `AND id != ALL($2::uuid[])` : ""}
       ORDER BY created_at DESC LIMIT $1`,
      existingIds.length > 0 ? [remaining, existingIds] : [remaining],
    );
    for (const row of notIndexed.rows) {
      staleDocs.push({ id: row.id, user_id: row.user_id, title: row.title, reason: "not_indexed" });
    }
  }

  // 3. Documents with no related document links (older than 1 day)
  const remaining2 = limit - staleDocs.length;
  if (remaining2 > 0) {
    const existingIds = staleDocs.map((d) => d.id);
    const noRelations = await pool.query(
      `SELECT d.id, d.user_id, d.title FROM documents d
       LEFT JOIN document_relations dr ON dr.document_id = d.id
       WHERE dr.id IS NULL
         AND d.indexed_at IS NOT NULL
         AND d.created_at < NOW() - INTERVAL '1 day'
         ${existingIds.length > 0 ? `AND d.id != ALL($2::uuid[])` : ""}
       ORDER BY d.created_at DESC LIMIT $1`,
      existingIds.length > 0 ? [remaining2, existingIds] : [remaining2],
    );
    for (const row of noRelations.rows) {
      staleDocs.push({ id: row.id, user_id: row.user_id, title: row.title, reason: "no_relations" });
    }
  }

  // Queue jobs (skip if already has a pending/processing job)
  const queued: StaleDoc[] = [];
  for (const doc of staleDocs) {
    const existing = await pool.query(
      `SELECT id FROM ingestion_jobs
       WHERE document_id = $1 AND status IN ('pending', 'processing')
       LIMIT 1`,
      [doc.id],
    );
    if (existing.rows.length === 0) {
      await createJob(doc.user_id, doc.id);
      queued.push(doc);
    }
  }

  return {
    queued: queued.length,
    documents: queued.map((d) => ({ id: d.id, title: d.title, reason: d.reason })),
  };
}
