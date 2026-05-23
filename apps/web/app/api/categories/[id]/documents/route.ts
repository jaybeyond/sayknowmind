import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/org-context";
import { writableClause, readableClause, editableViaShareClause } from "@/lib/visibility";
import { isOrgAdmin } from "@/lib/org-context";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";

/** GET /api/categories/[id]/documents — List documents in a category */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const { id } = await params;

  try {
    // Verify category is visible to the caller.
    // $1=id $2=userId $3=organizationId
    const catCheck = await pool.query(
      `SELECT c.id FROM categories c WHERE c.id = $1 AND ${readableClause("c", 3, 2, "category")}`,
      [id, ctx.userId, ctx.organizationId],
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

    // $1=categoryId $2=userId $3=organizationId
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM documents d
       JOIN document_categories dc ON dc.document_id = d.id
       WHERE dc.category_id = $1 AND ${readableClause("d", 3, 2, "document")}`,
      [id, ctx.userId, ctx.organizationId],
    );
    const total = Number(countResult.rows[0].count);

    // $1=categoryId $2=userId $3=organizationId $4=limit $5=offset
    const result = await pool.query(
      `SELECT d.id, d.title, d.url, d.source_type, d.created_at
       FROM documents d
       JOIN document_categories dc ON dc.document_id = d.id
       WHERE dc.category_id = $1 AND ${readableClause("d", 3, 2, "document")}
       ORDER BY d.created_at DESC
       LIMIT $4 OFFSET $5`,
      [id, ctx.userId, ctx.organizationId, limit, offset],
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
  const ctx = await getOrgContext();
  if (!ctx) {
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

    const admin = isOrgAdmin(ctx.role);

    // Verify category is writable by the caller
    // $1=id $2=userId $3=organizationId
    const catCheck = await pool.query(
      `SELECT id FROM categories WHERE id = $1 AND (${writableClause("categories", 3, 2, admin)} OR ${editableViaShareClause("categories", 2, "category")})`,
      [id, ctx.userId, ctx.organizationId],
    );
    if (catCheck.rowCount === 0) {
      return NextResponse.json(
        { code: ErrorCode.CATEGORY_NOT_FOUND, message: "Category not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }

    // Verify document is writable by the caller
    // $1=documentId $2=userId $3=organizationId
    const docCheck = await pool.query(
      `SELECT id FROM documents WHERE id = $1 AND (${writableClause("documents", 3, 2, admin)} OR ${editableViaShareClause("documents", 2, "document")})`,
      [documentId, ctx.userId, ctx.organizationId],
    );
    if (docCheck.rowCount === 0) {
      return NextResponse.json(
        { code: ErrorCode.SEARCH_NO_RESULTS, message: "Document not found", timestamp: new Date().toISOString() },
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
