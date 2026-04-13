import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pool } from "@/lib/db";

/**
 * Debug endpoint: shows current web user, their telegram link,
 * and document counts to diagnose user_id mismatch.
 */
export async function GET() {
  const webUserId = await getUserIdFromRequest();

  // All telegram links
  const links = await pool
    .query(
      `SELECT cl.user_id, cl.channel_user_id, cl.channel_username, cl.linked_at,
              u.name, u.email, LEFT(cl.bot_token, 10) as token_prefix
       FROM channel_links cl
       LEFT JOIN "user" u ON u.id = cl.user_id
       WHERE cl.channel = 'telegram'
       ORDER BY cl.updated_at DESC`,
    )
    .catch(() => ({ rows: [] }));

  // Document counts per user
  const docs = await pool
    .query(
      `SELECT user_id, metadata->>'source' as source, COUNT(*) as count
       FROM documents
       GROUP BY user_id, metadata->>'source'
       ORDER BY count DESC LIMIT 20`,
    )
    .catch(() => ({ rows: [] }));

  // Recent documents for current web user
  const recentDocs = webUserId
    ? await pool
        .query(
          `SELECT id, title, source_type, metadata->>'source' as source, created_at
           FROM documents WHERE user_id = $1
           ORDER BY created_at DESC LIMIT 5`,
          [webUserId],
        )
        .catch(() => ({ rows: [] }))
    : { rows: [] };

  return NextResponse.json({
    webUserId: webUserId ?? "NOT_LOGGED_IN",
    telegramLinks: links.rows.map((r: Record<string, unknown>) => ({
      userId: r.user_id,
      isCurrentUser: r.user_id === webUserId,
      telegramId: r.channel_user_id,
      telegramUsername: r.channel_username,
      userName: r.name,
      userEmail: r.email,
      tokenPrefix: r.token_prefix,
      linkedAt: r.linked_at,
    })),
    documentCounts: docs.rows,
    recentDocsForCurrentUser: recentDocs.rows,
  });
}
