import { NextRequest, NextResponse } from "next/server";
import { getOrgContext, isOrgAdmin } from "@/lib/org-context";
import { insertDocument } from "@/lib/ingest/document-store";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";
import { writableClause, editableViaShareClause } from "@/lib/visibility";

/** POST /api/docs — create a new blank doc or mind map, optionally inside a collection. */
export async function POST(request: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      title?: string;
      type?: "doc" | "mindmap";
      categoryId?: string | null;
    };
    const title =
      typeof body.title === "string" && body.title.trim() ? body.title.trim() : "Untitled";
    const docType = body.type === "mindmap" ? "mindmap" : "doc";
    const categoryId = typeof body.categoryId === "string" && body.categoryId ? body.categoryId : null;

    // If a target collection is given, verify the caller may write to it BEFORE
    // creating the doc, so an invalid id never leaves an orphaned document.
    if (categoryId) {
      const check = await pool.query(
        `SELECT id FROM categories
          WHERE id = $1 AND (${writableClause("categories", 3, 2, isOrgAdmin(ctx.role))} OR ${editableViaShareClause("categories", 2, "category")})`,
        [categoryId, ctx.userId, ctx.organizationId],
      );
      if (check.rows.length === 0) {
        return NextResponse.json(
          { code: ErrorCode.CATEGORY_NOT_FOUND, message: "Category not found", timestamp: new Date().toISOString() },
          { status: 404 },
        );
      }
    }

    const id =
      docType === "mindmap"
        ? await insertDocument({
            userId: ctx.userId,
            organizationId: ctx.organizationId,
            title,
            content: title,
            sourceType: "mindmap",
            metadata: { content_format: "mindmap", mindmap: { nodeData: { id: "root", topic: title } } },
          })
        : await insertDocument({
            userId: ctx.userId,
            organizationId: ctx.organizationId,
            title,
            content: "",
            sourceType: "doc",
            metadata: { content_format: "blocknote" },
          });

    if (categoryId) {
      await pool.query(
        `INSERT INTO document_categories (document_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [id, categoryId],
      );
    }

    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    console.error("[docs] POST error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
