import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/share/gallery — public endpoint, lists all public non-revoked shares */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const limit = Math.min(Number(searchParams.get("limit")) || 24, 100);
    const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);
    const search = searchParams.get("q")?.trim() || null;
    const categoryId = searchParams.get("categoryId") || null;

    // Base WHERE clause
    const baseWhere = `
      sc.is_revoked = false
      AND (sc.expires_at IS NULL OR sc.expires_at > NOW())
      AND sc.access_conditions->>'type' = 'public'
    `;

    // Build dynamic conditions
    const conditions = [baseWhere];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (search) {
      conditions.push(`(d.title ILIKE $${paramIdx} OR d.summary ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    if (categoryId) {
      conditions.push(`EXISTS (
        SELECT 1 FROM document_categories dc
        WHERE dc.document_id = d.id AND dc.category_id = $${paramIdx}
      )`);
      params.push(categoryId);
      paramIdx++;
    }

    const whereClause = conditions.join(" AND ");

    // Count total
    const countResult = await pool.query(
      `SELECT COUNT(*) AS total
       FROM shared_content sc
       JOIN documents d ON d.id = sc.document_id
       WHERE ${whereClause}`,
      params,
    );
    const total = Number(countResult.rows[0].total);

    // Fetch paginated items with categories
    const result = await pool.query(
      `SELECT sc.share_token, sc.created_at AS shared_at,
              d.title, d.summary, d.url, d.source_type, d.metadata,
              COALESCE(
                (SELECT json_agg(json_build_object('id', c.id, 'name', c.name))
                 FROM document_categories dc
                 JOIN categories c ON c.id = dc.category_id
                 WHERE dc.document_id = d.id),
                '[]'
              ) AS categories
       FROM shared_content sc
       JOIN documents d ON d.id = sc.document_id
       WHERE ${whereClause}
       ORDER BY sc.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset],
    );

    const items = result.rows.map((row: Record<string, unknown>) => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const cats = (Array.isArray(row.categories) ? row.categories : []) as { id: string; name: string }[];
      return {
        shareToken: row.share_token,
        title: row.title,
        summary: row.summary,
        url: row.url,
        sourceType: row.source_type,
        ogImage: typeof meta.ogImage === "string" ? meta.ogImage : null,
        aiSummary: typeof meta.summary === "string" ? meta.summary : null,
        whatItSolves: typeof meta.what_it_solves === "string" ? meta.what_it_solves : null,
        keyPoints: Array.isArray(meta.key_points) ? meta.key_points : null,
        readingTimeMinutes: typeof meta.reading_time_minutes === "number" ? meta.reading_time_minutes : null,
        tags: [...new Set([
          ...(Array.isArray(meta.aiTags) ? meta.aiTags : []),
          ...(Array.isArray(meta.userTags) ? meta.userTags : []),
          ...(Array.isArray(meta.tags) ? meta.tags : []),
        ].filter((t): t is string => typeof t === "string"))],
        categories: cats,
        sharedAt: row.shared_at,
      };
    });

    // Get all categories used in public shares (for filter UI)
    const catResult = await pool.query(
      `SELECT DISTINCT c.id, c.name, COUNT(*)::int AS count
       FROM shared_content sc
       JOIN documents d ON d.id = sc.document_id
       JOIN document_categories dc ON dc.document_id = d.id
       JOIN categories c ON c.id = dc.category_id
       WHERE ${baseWhere}
       GROUP BY c.id, c.name
       ORDER BY count DESC
       LIMIT 50`,
    );

    return NextResponse.json({
      items,
      total,
      hasMore: offset + limit < total,
      categories: catResult.rows,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load gallery";
    return NextResponse.json({ error: "server_error", message }, { status: 500 });
  }
}
