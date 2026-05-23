import { NextRequest, NextResponse } from "next/server";
import { getOrgContext, isOrgAdmin } from "@/lib/org-context";
import { pool } from "@/lib/db";
import { assignDocumentCategory } from "@/lib/ingest/document-store";
import { createCategory } from "@/lib/categories/store";
import { ErrorCode } from "@/lib/types";
import { readableClause, writableClause } from "@/lib/visibility";

/** GET /api/categories/suggest/[documentId] - Get suggestions for a document */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const { documentId } = await params;

  try {
    // $1=documentId $2=userId $3=organizationId
    const doc = await pool.query(
      `SELECT d.metadata
       FROM documents d
       WHERE d.id = $1 AND ${readableClause("d", 3, 2, "document")}`,
      [documentId, ctx.userId, ctx.organizationId],
    );

    if (doc.rows.length === 0) {
      return NextResponse.json(
        { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Document not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }

    const metadata = doc.rows[0].metadata || {};
    const suggestions = metadata.suggestedCategories || [];

    return NextResponse.json({ documentId, suggestions });
  } catch (err) {
    console.error("[categories/suggest] GET error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}

/** POST /api/categories/suggest/[documentId] - Approve or reject a suggestion */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const { documentId } = await params;

  try {
    const body = await request.json();
    const { action, categoryId, categoryName } = body as {
      action: "approve" | "reject";
      categoryId?: string;
      categoryName?: string;
    };

    if (!action || !["approve", "reject"].includes(action)) {
      return NextResponse.json(
        { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Action must be 'approve' or 'reject'", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    const admin = isOrgAdmin(ctx.role);

    // Verify document is writable by the caller
    // $1=documentId $2=userId $3=organizationId
    const doc = await pool.query(
      `SELECT id, metadata FROM documents WHERE id = $1 AND ${writableClause("documents", 3, 2, admin)}`,
      [documentId, ctx.userId, ctx.organizationId],
    );
    if (doc.rows.length === 0) {
      return NextResponse.json(
        { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Document not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }

    if (action === "approve") {
      let targetCategoryId = categoryId;

      // If categoryId is "new", create a new category
      if (categoryId === "new" && categoryName) {
        const newCat = await createCategory({
          ctx,
          name: categoryName,
        });
        targetCategoryId = newCat.id;
      }

      if (!targetCategoryId) {
        return NextResponse.json(
          { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "categoryId is required for approval", timestamp: new Date().toISOString() },
          { status: 400 },
        );
      }

      // Verify target category is visible to the caller
      // $1=targetCategoryId $2=userId $3=organizationId
      const category = await pool.query(
        `SELECT id FROM categories WHERE id = $1 AND ${readableClause("categories", 3, 2, "category")}`,
        [targetCategoryId, ctx.userId, ctx.organizationId],
      );
      if (category.rows.length === 0) {
        return NextResponse.json(
          { code: ErrorCode.CATEGORY_NOT_FOUND, message: "Category not found", timestamp: new Date().toISOString() },
          { status: 404 },
        );
      }

      // Assign document to category
      await assignDocumentCategory(documentId, targetCategoryId);

      // Remove suggestion from metadata
      const metadata = doc.rows[0].metadata || {};
      const suggestions = (metadata.suggestedCategories || []).filter(
        (s: { categoryId: string; categoryName: string }) =>
          s.categoryId !== categoryId && s.categoryName !== categoryName,
      );
      await pool.query(
        `UPDATE documents SET metadata = jsonb_set(metadata, '{suggestedCategories}', $1::jsonb)
         WHERE id = $2`,
        [JSON.stringify(suggestions), documentId],
      );

      return NextResponse.json({
        success: true,
        action: "approved",
        categoryId: targetCategoryId,
      });
    }

    // Rejection: store feedback for learning
    if (action === "reject") {
      const metadata = doc.rows[0].metadata || {};
      const rejections = metadata.rejectedSuggestions || [];
      rejections.push({
        categoryId,
        categoryName,
        rejectedAt: new Date().toISOString(),
      });

      // Remove from suggestions, add to rejections
      const suggestions = (metadata.suggestedCategories || []).filter(
        (s: { categoryId: string; categoryName: string }) =>
          s.categoryId !== categoryId && s.categoryName !== categoryName,
      );

      await pool.query(
        `UPDATE documents SET metadata = metadata ||
          jsonb_build_object('suggestedCategories', $1::jsonb, 'rejectedSuggestions', $2::jsonb)
         WHERE id = $3`,
        [JSON.stringify(suggestions), JSON.stringify(rejections), documentId],
      );

      return NextResponse.json({
        success: true,
        action: "rejected",
      });
    }
  } catch (err) {
    console.error("[categories/suggest] POST error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
