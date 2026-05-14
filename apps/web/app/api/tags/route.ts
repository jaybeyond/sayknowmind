import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { listTags } from "@/lib/tags/store";
import { ErrorCode } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/tags — list every tag the calling user owns */
export async function GET() {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }
  try {
    const tags = await listTags(userId);
    return NextResponse.json({
      tags: tags.map((t) => ({
        id: t.id,
        name: t.name,
        canonical_name: t.canonical_name,
        created_at: t.created_at,
      })),
    });
  } catch (err) {
    console.error("[tags] GET error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
