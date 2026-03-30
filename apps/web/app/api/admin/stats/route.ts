import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession, requireAdmin } from "@/lib/admin";

/** GET /api/admin/stats — Platform-wide aggregate stats */
export async function GET() {
  const session = await getSession();
  try {
    await requireAdmin(session);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Forbidden";
    const status = msg === "Unauthorized" ? 401 : 403;
    return NextResponse.json({ error: msg }, { status });
  }

  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM "user") as total_users,
       (SELECT COUNT(*)::int FROM documents WHERE status != 'trashed') as total_documents,
       (SELECT COUNT(*)::int FROM categories) as total_categories,
       (SELECT COUNT(*)::int FROM conversations) as total_conversations,
       (SELECT COUNT(*)::int FROM "user" WHERE "createdAt"::date = CURRENT_DATE) as users_today`,
  );

  return NextResponse.json(result.rows[0]);
}
