import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { ErrorCode } from "@/lib/types";
import { revokeAccess } from "@/lib/shared-mode";

type RouteContext = { params: Promise<{ id: string }> };

/** DELETE /api/share/[id] — revoke a share */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  try {
    const { id } = await context.params;
    const result = await revokeAccess(id, userId);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to revoke share";
    const status = message.includes("not found") ? 404 : 500;
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message, timestamp: new Date().toISOString() },
      { status },
    );
  }
}
