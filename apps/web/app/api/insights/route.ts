import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/org-context";
import { pool } from "@/lib/db";
import { readableClause, orgScopeClause } from "@/lib/visibility";

export const dynamic = "force-dynamic";

/** GET /api/insights — knowledge vault stats */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // $1 = userId, $2 = organizationId — fixed positions for all queries.
  const { userId, organizationId } = ctx;

  try {
    const [totalRes, weekRes, topCatsRes, recentRelRes, pendingRes] = await Promise.all([
      // Total documents visible to the org member
      pool.query(
        `SELECT COUNT(*) as count FROM documents d
         WHERE ${readableClause("d", 2, 1, "document")}`,
        [userId, organizationId],
      ),
      // This week
      pool.query(
        `SELECT COUNT(*) as count FROM documents d
         WHERE ${readableClause("d", 2, 1, "document")}
           AND d.created_at >= NOW() - INTERVAL '7 days'`,
        [userId, organizationId],
      ),
      // Top 3 categories
      pool.query(
        `SELECT c.name, COUNT(dc.document_id) as count
         FROM document_categories dc
         JOIN categories c ON c.id = dc.category_id
         JOIN documents d ON d.id = dc.document_id
         WHERE ${readableClause("d", 2, 1, "document")}
           AND ${readableClause("c", 2, 1, "category")}
         GROUP BY c.name
         ORDER BY count DESC LIMIT 3`,
        [userId, organizationId],
      ),
      // Recent related document pairs
      pool.query(
        `SELECT d1.title as doc_title, d2.title as related_title, dr.score
         FROM document_relations dr
         JOIN documents d1 ON d1.id = dr.document_id
         JOIN documents d2 ON d2.id = dr.related_document_id
         WHERE ${readableClause("d1", 2, 1, "document")}
         ORDER BY dr.created_at DESC LIMIT 5`,
        [userId, organizationId],
      ),
      // Pending processing
      pool.query(
        `SELECT COUNT(*) as count FROM ingestion_jobs ij
         WHERE ${orgScopeClause("ij", 2)} AND ij.status IN ('pending', 'processing')`,
        [userId, organizationId],
      ),
    ]);

    return NextResponse.json({
      totalDocuments: parseInt(totalRes.rows[0].count, 10),
      thisWeek: parseInt(weekRes.rows[0].count, 10),
      topCategories: topCatsRes.rows.map((r: { name: string; count: string }) => ({
        name: r.name,
        count: parseInt(r.count, 10),
      })),
      recentRelations: recentRelRes.rows.map((r: { doc_title: string; related_title: string; score: number }) => ({
        docTitle: r.doc_title,
        relatedTitle: r.related_title,
        score: r.score,
      })),
      pendingJobs: parseInt(pendingRes.rows[0].count, 10),
    });
  } catch {
    return NextResponse.json({
      totalDocuments: 0, thisWeek: 0, topCategories: [], recentRelations: [], pendingJobs: 0,
    });
  }
}
