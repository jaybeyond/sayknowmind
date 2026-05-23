import { NextRequest, NextResponse } from "next/server";
import { getOrgContext, isOrgAdmin } from "@/lib/org-context";
import { writableClause } from "@/lib/visibility";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";

/** DELETE /api/conversations/[id] — Delete a conversation */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getOrgContext();
    if (!ctx) {
      return NextResponse.json(
        { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
        { status: 401 },
      );
    }

    const { id } = await params;

    // writableClause(alias, orgIdx, userIdx, isAdmin)
    // $1 = id, $2 = organizationId, $3 = userId
    // Messages cascade-delete via FK
    const result = await pool.query(
      `DELETE FROM conversations c
       WHERE c.id = $1 AND ${writableClause("c", 2, 3, isOrgAdmin(ctx.role))}`,
      [id, ctx.organizationId, ctx.userId],
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { code: ErrorCode.CATEGORY_NOT_FOUND, message: "Conversation not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[conversations/[id]] DELETE error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
