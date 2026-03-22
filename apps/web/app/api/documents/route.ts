import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/documents — list documents with pagination, search, and category filter */
export async function GET(request: NextRequest) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const { searchParams } = request.nextUrl;
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? 50)));
  const offset = (page - 1) * limit;
  const search = searchParams.get("q")?.trim() ?? "";
  const categoryId = searchParams.get("categoryId") ?? "";
  const sourceType = searchParams.get("sourceType") ?? "";
  const isFavorite = searchParams.get("isFavorite");

  try {
    const conditions: string[] = ["d.user_id = $1"];
    const params: unknown[] = [userId];
    let paramIdx = 2;

    if (search) {
      conditions.push(`(d.title ILIKE $${paramIdx} OR d.summary ILIKE $${paramIdx} OR d.url ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    if (categoryId) {
      conditions.push(`EXISTS (SELECT 1 FROM document_categories dc WHERE dc.document_id = d.id AND dc.category_id = $${paramIdx})`);
      params.push(categoryId);
      paramIdx++;
    }

    if (sourceType) {
      conditions.push(`d.source_type = $${paramIdx}`);
      params.push(sourceType);
      paramIdx++;
    }

    if (isFavorite === "true") {
      conditions.push(`(d.metadata->>'isFavorite')::boolean = true`);
    }

    const status = searchParams.get("status") ?? "active";
    if (status !== "all") {
      conditions.push(`COALESCE(d.metadata->>'status', 'active') = $${paramIdx}`);
      params.push(status);
      paramIdx++;
    }

    const where = conditions.join(" AND ");

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM documents d WHERE ${where}`,
      params,
    );
    const total = Number(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT d.id, d.title, d.content, d.summary, d.url, d.source_type,
              d.metadata, d.privacy_level, d.created_at, d.updated_at, d.indexed_at,
              COALESCE(
                (SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'color', c.color))
                 FROM document_categories dc
                 JOIN categories c ON c.id = dc.category_id
                 WHERE dc.document_id = d.id), '[]'
              ) AS categories,
              (SELECT ij.status FROM ingestion_jobs ij
               WHERE ij.document_id = d.id
               ORDER BY ij.created_at DESC LIMIT 1) AS job_status
       FROM documents d
       WHERE ${where}
       ORDER BY d.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset],
    );

    return NextResponse.json({
      documents: dataResult.rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("[documents] GET error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
