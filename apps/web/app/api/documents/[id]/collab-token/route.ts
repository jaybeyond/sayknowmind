import { NextRequest, NextResponse } from "next/server";
import { getOrgContext, isOrgAdmin } from "@/lib/org-context";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";
import { readableClause, writableClause, editableViaShareClause } from "@/lib/visibility";
import { issueCollabToken, getCollabWsUrl, isCollabConfigured } from "@/lib/collab/token";

type RouteContext = { params: Promise<{ id: string }> };

/** Stable per-user cursor color so a collaborator looks the same to everyone. */
function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

/**
 * GET /api/documents/:id/collab-token
 *
 * Issues a short-lived, document-scoped token for the Hocuspocus WS server.
 * Read access is required (404 otherwise); write access decides `canWrite`,
 * which the WS server turns into read-only mode for view-only collaborators.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  if (!isCollabConfigured()) {
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Collaboration is not configured", timestamp: new Date().toISOString() },
      { status: 503 },
    );
  }

  const { id } = await context.params;

  try {
    // One query resolves both "can the caller see it" and "can they edit it".
    // params: $1 = id, $2 = ctx.userId, $3 = ctx.organizationId
    const result = await pool.query(
      `SELECT
         (${writableClause("d", 3, 2, isOrgAdmin(ctx.role))} OR ${editableViaShareClause("d", 2, "document")}) AS can_write
       FROM documents d
       WHERE d.id = $1 AND ${readableClause("d", 3, 2, "document")}`,
      [id, ctx.userId, ctx.organizationId],
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { code: ErrorCode.SEARCH_NO_RESULTS, message: "Document not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }

    const canWrite = result.rows[0].can_write === true;

    // Display name + avatar for cursor labels and the presence stack.
    const userRow = await pool.query(`SELECT name, image FROM "user" WHERE id = $1`, [ctx.userId]);
    const name =
      (typeof userRow.rows[0]?.name === "string" && userRow.rows[0].name.trim()) ||
      `User ${ctx.userId.slice(0, 6)}`;
    const image =
      typeof userRow.rows[0]?.image === "string" && userRow.rows[0].image.trim()
        ? userRow.rows[0].image
        : null;

    const token = issueCollabToken(ctx.userId, ctx.organizationId, id, canWrite);

    return NextResponse.json({
      token,
      wsUrl: getCollabWsUrl(),
      canWrite,
      user: { id: ctx.userId, name, color: colorForUser(ctx.userId), image },
    });
  } catch (err) {
    console.error("[documents] collab-token error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
