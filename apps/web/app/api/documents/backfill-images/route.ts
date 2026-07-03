import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/org-context";
import { backfillDocumentImages } from "@/lib/ingest/backfill-images";
import { ErrorCode } from "@/lib/types";

export const dynamic = "force-dynamic";
// The batch re-fetches external pages/images; give it room on the persistent
// server (ignored by hosts without a per-request cap).
export const maxDuration = 300;

async function handle(request: NextRequest) {
  const ctx = await getOrgContext().catch(() => null);
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const limitParam = Number(request.nextUrl.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined;

  const result = await backfillDocumentImages(ctx, { limit });

  return NextResponse.json({
    message:
      `Backfilled ${result.fixedOg} link preview(s) + ${result.fixedFile} uploaded image(s) ` +
      `of ${result.scanned} scanned (${result.unrecoverable} had no recoverable source). ` +
      `Re-run to continue if scanned hit the limit.`,
    ...result,
  });
}

/** POST /api/documents/backfill-images?limit=100 — restore missing list thumbnails. */
export async function POST(request: NextRequest) {
  return handle(request);
}

/** GET convenience (same behavior) so it can be triggered from a browser. */
export async function GET(request: NextRequest) {
  return handle(request);
}
