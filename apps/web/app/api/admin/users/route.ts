import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getSession, requireAdmin } from "@/lib/admin";

/** GET /api/admin/users — List all users with aggregated stats */
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
    `SELECT u.id, u.name, u.email, u."emailVerified", u.image, u.role, u."createdAt",
            COUNT(DISTINCT d.id)::int as document_count,
            COUNT(DISTINCT c.id)::int as category_count,
            COUNT(DISTINCT conv.id)::int as conversation_count,
            MAX(s."createdAt") as last_active
     FROM "user" u
     LEFT JOIN documents d ON d.user_id = u.id AND d.status != 'trashed'
     LEFT JOIN categories c ON c.user_id = u.id
     LEFT JOIN conversations conv ON conv.user_id = u.id
     LEFT JOIN session s ON s."userId" = u.id
     GROUP BY u.id
     ORDER BY u."createdAt" DESC`,
  );

  return NextResponse.json(result.rows);
}
