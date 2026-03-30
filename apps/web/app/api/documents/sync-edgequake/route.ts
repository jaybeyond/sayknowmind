import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pool } from "@/lib/db";
import { syncUnindexedToEdgeQuake, healthCheck } from "@/lib/edgequake/client";
import { ErrorCode } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/documents/sync-edgequake
 * Push un-indexed documents to EdgeQuake for vectorization + graph extraction.
 * Does NOT re-run AI processing — only the EdgeQuake indexing step.
 */
export async function POST() {
  let userId: string | null = null;
  try {
    userId = await getUserIdFromRequest();
  } catch { /* fall through */ }

  const eqUp = await healthCheck();
  if (!eqUp) {
    return NextResponse.json(
      { message: "EdgeQuake is not available", synced: 0, failed: 0 },
      { status: 503 },
    );
  }

  // If authenticated, sync only that user's docs
  if (userId) {
    const result = await syncUnindexedToEdgeQuake(userId);
    return NextResponse.json({
      message: `Synced ${result.synced} document(s) to EdgeQuake`,
      ...result,
    });
  }

  // No auth → admin/maintenance mode: sync ALL users with un-indexed docs
  const users = await pool.query(
    `SELECT DISTINCT user_id FROM documents WHERE indexed_at IS NULL AND content IS NOT NULL AND content <> ''`,
  );

  let totalSynced = 0;
  let totalFailed = 0;
  const allErrors: string[] = [];

  for (const row of users.rows) {
    const result = await syncUnindexedToEdgeQuake(row.user_id);
    totalSynced += result.synced;
    totalFailed += result.failed;
    allErrors.push(...result.errors);
  }

  return NextResponse.json({
    message: `Synced ${totalSynced} document(s) to EdgeQuake across ${users.rows.length} user(s)`,
    synced: totalSynced,
    failed: totalFailed,
    errors: allErrors,
  });
}

/** GET for dev convenience */
export async function GET() {
  return POST();
}
