import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/documents/:id/related — fetch related documents */
export async function GET(_request: NextRequest, context: RouteContext) {
  let userId: string | null = null;
  try { userId = await getUserIdFromRequest(); } catch { /* auth error */ }
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const { id } = await context.params;

  try {
    // Verify the document belongs to the user
    const docCheck = await pool.query(
      `SELECT id FROM documents WHERE id = $1 AND user_id = $2`,
      [id, userId],
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
       WHERE dr.document_id = $1
       ORDER BY dr.score DESC
       LIMIT 10`,
      [id],
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
