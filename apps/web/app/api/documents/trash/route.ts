import { NextResponse } from "next/server";
import { getOrgContext, isOrgAdmin } from "@/lib/org-context";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";
import { writableClause, editableViaShareClause } from "@/lib/visibility";
import { emitDocumentEvent } from "@/lib/events";

// DELETE /api/documents/trash — empty the trash: permanently hard-delete every
// document currently in the "trashed" state that the caller is allowed to
// delete. Static segment, so it never collides with /api/documents/[id].
export async function DELETE() {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  try {
    // params: $1 = userId, $2 = organizationId
    const result = await pool.query(
      `DELETE FROM documents
         WHERE COALESCE(metadata->>'status', 'active') = 'trashed'
           AND (${writableClause("documents", 2, 1, isOrgAdmin(ctx.role))} OR ${editableViaShareClause("documents", 1, "document")})
       RETURNING id`,
      [ctx.userId, ctx.organizationId],
    );

    for (const row of result.rows) {
      emitDocumentEvent({ type: "document:deleted", documentId: row.id as string, userId: ctx.userId });
    }

    return NextResponse.json({ deleted: true, count: result.rows.length });
  } catch (err) {
    console.error("[documents] DELETE /trash error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
