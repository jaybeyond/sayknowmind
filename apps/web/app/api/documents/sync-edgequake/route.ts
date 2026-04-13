import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { syncUnindexedToEdgeQuake, healthCheck } from "@/lib/edgequake/client";

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

  if (!userId) {
    return NextResponse.json(
      { message: "Unauthorized", synced: 0, failed: 0 },
      { status: 401 },
    );
  }

  const result = await syncUnindexedToEdgeQuake(userId);
  return NextResponse.json({
    message: `Synced ${result.synced} document(s) to EdgeQuake`,
    ...result,
  });
}

/** GET for dev convenience */
export async function GET() {
  return POST();
}
