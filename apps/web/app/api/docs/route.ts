import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/org-context";
import { insertDocument } from "@/lib/ingest/document-store";
import { ErrorCode } from "@/lib/types";

/** POST /api/docs — create a new blank doc (source_type='doc') */
export async function POST(request: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  try {
    const body = await request.json().catch(() => ({})) as { title?: string };
    const title = typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : "Untitled";

    const id = await insertDocument({
      userId: ctx.userId,
      organizationId: ctx.organizationId,
      title,
      content: "",
      sourceType: "doc",
      metadata: { content_format: "blocknote" },
    });

    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    console.error("[docs] POST error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
