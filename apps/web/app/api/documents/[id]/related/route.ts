import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/org-context";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";
import { readableClause } from "@/lib/visibility";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/documents/:id/related — fetch related documents */
export async function GET(_request: NextRequest, context: RouteContext) {
  let ctx: Awaited<ReturnType<typeof getOrgContext>> = null;
  try { ctx = await getOrgContext(); } catch { /* auth error */ }
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const { id } = await context.params;

  try {
    // params: $1 = id, $2 = ctx.userId, $3 = ctx.organizationId
    // Verify the document is visible to the user.
    const docCheck = await pool.query(
      `SELECT d.id FROM documents d WHERE d.id = $1 AND ${readableClause("d", 3, 2, "document")}`,
      [id, ctx.userId, ctx.organizationId],
    );
    if (docCheck.rows.length === 0) {
      return NextResponse.json(
        { code: ErrorCode.SEARCH_NO_RESULTS, message: "Document not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }

    const result = await pool.query(
      `SELECT dr.related_document_id AS id, d.title, dr.score
       FROM document_relations dr
       JOIN documents d ON d.id = dr.related_document_id
       WHERE dr.document_id = $1 AND ${readableClause("d", 3, 2, "document")}
       ORDER BY dr.score DESC
       LIMIT 10`,
      [id, ctx.userId, ctx.organizationId],
    );

    return NextResponse.json({ relations: result.rows });
  } catch (err) {
    console.error("[api/documents/related] Error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
