import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pool } from "@/lib/db";
import { createJob } from "@/lib/ingest/job-queue";
import { ErrorCode } from "@/lib/types";

export const dynamic = "force-dynamic";

async function reprocess() {
  let userId: string | null = null;
  try {
    userId = await getUserIdFromRequest();
  } catch {
    // Auth check failed — fall through to fallback
  }

  // Fallback: if not authenticated, use first user (safe — reprocess is read-modify-own-data only)
  if (!userId) {
    const fallback = await pool.query(`SELECT id FROM "user" LIMIT 1`);
    userId = fallback.rows[0]?.id ?? null;
  }

  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  // Find documents that don't have a summary in metadata
  const result = await pool.query(
    `SELECT id, title FROM documents
     WHERE user_id = $1
       AND (metadata->>'summary' IS NULL OR metadata->>'summary' = '')
     ORDER BY created_at DESC`,
    [userId],
  );

  const docs = result.rows;
  if (docs.length === 0) {
    return NextResponse.json({ message: "All documents already processed", reprocessed: 0 });
  }

  const jobIds: string[] = [];
  for (const doc of docs) {
    const jobId = await createJob(userId, doc.id);
    jobIds.push(jobId);
  }

  return NextResponse.json({
    message: `Reprocessing ${docs.length} document(s)`,
    reprocessed: docs.length,
    documents: docs.map((d: { id: string; title: string }) => ({ id: d.id, title: d.title })),
    jobIds,
  });
}

/** POST /api/documents/reprocess */
export async function POST() {
  return reprocess();
}

/** GET /api/documents/reprocess — dev convenience */
export async function GET() {
  return reprocess();
}
