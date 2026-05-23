import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/org-context";
import { syncUnindexedToEdgeQuake, healthCheck } from "@/lib/edgequake/client";

export const dynamic = "force-dynamic";

/**
 * POST /api/documents/sync-edgequake
 * Push un-indexed documents to EdgeQuake for vectorization + graph extraction.
 * Does NOT re-run AI processing — only the EdgeQuake indexing step.
 */
export async function POST() {
  let ctx: Awaited<ReturnType<typeof getOrgContext>> = null;
  try {
    ctx = await getOrgContext();
  } catch { /* fall through */ }

  const eqUp = await healthCheck();
  if (!eqUp) {
    return NextResponse.json(
      { message: "EdgeQuake is not available", synced: 0, failed: 0 },
      { status: 503 },
    );
  }

  if (!ctx) {
    return NextResponse.json(
      { message: "Unauthorized", synced: 0, failed: 0 },
      { status: 401 },
    );
  }

  const result = await syncUnindexedToEdgeQuake(ctx.userId, ctx.organizationId);
  return NextResponse.json({
    message: `Synced ${result.synced} document(s) to EdgeQuake`,
    ...result,
  });
}

/** GET for dev convenience */
export async function GET() {
  return POST();
}
