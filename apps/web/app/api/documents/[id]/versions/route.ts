import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/org-context";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";
import { readableClause } from "@/lib/visibility";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/documents/:id/versions — list saved checkpoints, newest first. */
export async function GET(_request: NextRequest, context: RouteContext) {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const { id } = await context.params;

  try {
    // The caller must be able to read the document to see its history.
    const doc = await pool.query(
      `SELECT 1 FROM documents d WHERE d.id = $1 AND ${readableClause("d", 3, 2, "document")}`,
      [id, ctx.userId, ctx.organizationId],
    );
    if (doc.rows.length === 0) {
      return NextResponse.json(
        { code: ErrorCode.SEARCH_NO_RESULTS, message: "Document not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }

    const result = await pool.query(
      `SELECT v.id, v.created_at, v.created_by, v.title, v.content,
              u.name AS author_name, u.email AS author_email, u.image AS author_image
         FROM document_versions v
         LEFT JOIN "user" u ON u.id = v.created_by
        WHERE v.document_id = $1
        ORDER BY v.created_at DESC`,
      [id],
    );

    return NextResponse.json({
      versions: result.rows.map((r: {
        id: string; created_at: string; created_by: string;
        title: string | null; content: string | null;
        author_name: string | null; author_email: string | null; author_image: string | null;
      }) => ({
        id: r.id,
        createdAt: r.created_at,
        title: r.title,
        content: r.content,
        author: {
          id: r.created_by,
          name: r.author_name,
          email: r.author_email,
          image: r.author_image,
        },
      })),
    });
  } catch (err) {
    console.error("[documents] versions list error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
