import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/org-context";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";
import { readableClause } from "@/lib/visibility";

export const dynamic = "force-dynamic";

/** GET /api/documents — list documents with pagination, search, and category filter */
export async function GET(request: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) {
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
    // $1 = ctx.userId, orgId appended last as $N
    const params: unknown[] = [ctx.userId];
    let paramIdx = 2;

    // Reserve slot for orgId — will be appended after all other params are built.
    // We use a placeholder reference "orgIdx" that equals params.length + 1 once
    // orgId is appended. Build conditions first, then push orgId.
    //
    // Strategy: push orgId as the SECOND param so all visibilityClause calls use
    // consistent indices. $1 = userId, $2 = organizationId, $3+ = filter values.
    // Insert orgId at index 1 (position $2) before building conditions.
    params.push(ctx.organizationId); // $2
    paramIdx = 3; // next filter param starts at $3

    const conditions: string[] = [readableClause("d", 2, 1, "document")];

    if (search) {
      conditions.push(`(d.title ILIKE $${paramIdx} OR d.summary ILIKE $${paramIdx} OR d.url ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    if (categoryId) {
      conditions.push(
        `EXISTS (
          SELECT 1 FROM document_categories dc
          JOIN categories c ON c.id = dc.category_id
          WHERE dc.document_id = d.id AND dc.category_id = $${paramIdx}
            AND ${readableClause("c", 2, 1, "category")}
        )`,
      );
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
                 WHERE dc.document_id = d.id AND ${readableClause("c", 2, 1, "category")}), '[]'
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
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: offset + dataResult.rows.length < total && dataResult.rows.length > 0,
        nextPage: offset + dataResult.rows.length < total ? page + 1 : null,
      },
    });
  } catch (err) {
    console.error("[documents] GET error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
