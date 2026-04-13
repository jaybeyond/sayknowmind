import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pool } from "@/lib/db";
import { createJob } from "@/lib/ingest/job-queue";
import { runReprocessor } from "@/lib/ingest/reprocessor";
import { ErrorCode } from "@/lib/types";

export const dynamic = "force-dynamic";

async function reprocess(request: NextRequest) {
  let userId: string | null = null;
  try {
    userId = await getUserIdFromRequest();
  } catch {
    // Auth check failed
  }

  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  // Auto mode: find stale docs automatically
  const auto = request.nextUrl.searchParams.get("auto") === "1";
  if (auto) {
    const result = await runReprocessor({ limit: 20 });
    return NextResponse.json({
      message: `Auto-reprocessor queued ${result.queued} document(s)`,
      ...result,
    });
  }

  // Parse optional params
  const locale = request.nextUrl.searchParams.get("locale");
  const all = request.nextUrl.searchParams.get("all") === "1";

  // Find documents to reprocess
  const query = all
    ? `SELECT id, title FROM documents WHERE user_id = $1 ORDER BY created_at DESC`
    : `SELECT id, title FROM documents
       WHERE user_id = $1
         AND (metadata->>'summary' IS NULL OR metadata->>'summary' = '')
       ORDER BY created_at DESC`;
  const result = await pool.query(query, [userId]);

  const docs = result.rows;
  if (docs.length === 0) {
    return NextResponse.json({ message: "All documents already processed", reprocessed: 0 });
  }

  // If locale provided, update language in metadata for all docs so job queue uses it
  const validLocales = ["ko", "en", "ja", "zh"];
  if (locale && validLocales.includes(locale)) {
    for (const doc of docs) {
      await pool.query(
        `UPDATE documents SET metadata = metadata || $1::jsonb WHERE id = $2`,
        [JSON.stringify({ language: locale }), doc.id],
      );
    }
  }

  const jobIds: string[] = [];
  for (const doc of docs) {
    const jobId = await createJob(userId, doc.id);
    jobIds.push(jobId);
  }

  return NextResponse.json({
    message: `Reprocessing ${docs.length} document(s)${locale ? ` in ${locale}` : ""}`,
    reprocessed: docs.length,
    documents: docs.map((d: { id: string; title: string }) => ({ id: d.id, title: d.title })),
    jobIds,
  });
}

/** POST /api/documents/reprocess */
export async function POST(request: NextRequest) {
  return reprocess(request);
}

/** GET /api/documents/reprocess — dev convenience */
export async function GET(request: NextRequest) {
  return reprocess(request);
}
