import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/insights — knowledge vault stats */
export async function GET() {
  let userId: string | null = null;
  try { userId = await getUserIdFromRequest(); } catch { /* auth error */ }
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
  const [totalRes, weekRes, topCatsRes, recentRelRes, pendingRes] = await Promise.all([
    // Total documents
    pool.query(
      `SELECT COUNT(*) as count FROM documents WHERE user_id = $1`,
      [userId],
    ),
    // This week
    pool.query(
      `SELECT COUNT(*) as count FROM documents
       WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '7 days'`,
      [userId],
    ),
    // Top 3 categories
    pool.query(
      `SELECT c.name, COUNT(dc.document_id) as count
       FROM document_categories dc
       JOIN categories c ON c.id = dc.category_id
       JOIN documents d ON d.id = dc.document_id
       WHERE d.user_id = $1
       GROUP BY c.name
       ORDER BY count DESC LIMIT 3`,
      [userId],
    ),
    // Recent related document pairs
    pool.query(
      `SELECT d1.title as doc_title, d2.title as related_title, dr.score
       FROM document_relations dr
       JOIN documents d1 ON d1.id = dr.document_id
       JOIN documents d2 ON d2.id = dr.related_document_id
       WHERE d1.user_id = $1
       ORDER BY dr.created_at DESC LIMIT 5`,
      [userId],
    ),
    // Pending processing
    pool.query(
      `SELECT COUNT(*) as count FROM ingestion_jobs
       WHERE user_id = $1 AND status IN ('pending', 'processing')`,
      [userId],
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
