import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";

/** GET /api/categories/[id]/documents — List documents in a category */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const { id } = await params;

  try {
    // Verify category belongs to user
    const catCheck = await pool.query(
      `SELECT id FROM categories WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (catCheck.rowCount === 0) {
      return NextResponse.json(
        { code: ErrorCode.CATEGORY_NOT_FOUND, message: "Category not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }

    const { searchParams } = _request.nextUrl;
    const page = Math.max(1, Number(searchParams.get("page") ?? 1));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 20)));
    const offset = (page - 1) * limit;

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM documents d
       JOIN document_categories dc ON dc.document_id = d.id
       WHERE dc.category_id = $1 AND d.user_id = $2`,
      [id, userId],
    );
    const total = Number(countResult.rows[0].count);

    const result = await pool.query(
      `SELECT d.id, d.title, d.url, d.source_type, d.created_at
       FROM documents d
       JOIN document_categories dc ON dc.document_id = d.id
       WHERE dc.category_id = $1 AND d.user_id = $2
       ORDER BY d.created_at DESC
       LIMIT $3 OFFSET $4`,
      [id, userId, limit, offset],
    );

    return NextResponse.json({
      documents: result.rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("[categories/documents] GET error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}

/** DELETE /api/categories/[id]/documents — Remove a document from a category */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { documentId } = body as { documentId?: string };

    if (!documentId) {
      return NextResponse.json(
        { code: ErrorCode.SEARCH_INVALID_QUERY, message: "documentId is required", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    // Verify category belongs to user
    const catCheck = await pool.query(
      `SELECT id FROM categories WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (catCheck.rowCount === 0) {
      return NextResponse.json(
        { code: ErrorCode.CATEGORY_NOT_FOUND, message: "Category not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }

    await pool.query(
      `DELETE FROM document_categories WHERE category_id = $1 AND document_id = $2`,
      [id, documentId],
    );

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[categories/documents] DELETE error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
