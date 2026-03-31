import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/share/gallery — public endpoint, lists all public non-revoked shares */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const limit = Math.min(Number(searchParams.get("limit")) || 24, 100);
    const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);

    // Count total public shares
    const countResult = await pool.query(
      `SELECT COUNT(*) AS total
       FROM shared_content sc
       JOIN documents d ON d.id = sc.document_id
       WHERE sc.is_revoked = false
         AND (sc.expires_at IS NULL OR sc.expires_at > NOW())
         AND sc.access_conditions->>'type' = 'public'`,
    );
    const total = Number(countResult.rows[0].total);

    // Fetch paginated items
    const result = await pool.query(
      `SELECT sc.share_token, sc.created_at AS shared_at,
              d.title, d.summary, d.url, d.source_type, d.metadata
       FROM shared_content sc
       JOIN documents d ON d.id = sc.document_id
       WHERE sc.is_revoked = false
         AND (sc.expires_at IS NULL OR sc.expires_at > NOW())
         AND sc.access_conditions->>'type' = 'public'
       ORDER BY sc.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    const items = result.rows.map((row) => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      return {
        shareToken: row.share_token,
        title: row.title,
        summary: row.summary,
        url: row.url,
        sourceType: row.source_type,
        ogImage: typeof meta.ogImage === "string" ? meta.ogImage : null,
        aiSummary: typeof meta.summary === "string" ? meta.summary : null,
        whatItSolves:
          typeof meta.what_it_solves === "string" ? meta.what_it_solves : null,
        keyPoints: Array.isArray(meta.key_points) ? meta.key_points : null,
        readingTimeMinutes:
          typeof meta.reading_time_minutes === "number"
            ? meta.reading_time_minutes
            : null,
        tags: [
          ...new Set(
            [
              ...(Array.isArray(meta.aiTags) ? meta.aiTags : []),
              ...(Array.isArray(meta.userTags) ? meta.userTags : []),
              ...(Array.isArray(meta.tags) ? meta.tags : []),
            ].filter((t): t is string => typeof t === "string"),
          ),
        ],
        sharedAt: row.shared_at,
      };
    });

    return NextResponse.json({
      items,
      total,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load gallery";
    return NextResponse.json(
      { error: "server_error", message },
      { status: 500 },
    );
  }
}
