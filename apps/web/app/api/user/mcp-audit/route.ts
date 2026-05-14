import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/mcp-audit — return the calling user's recent MCP tool
 * calls so they can see what their key has been doing. Newest first.
 *
 * `limit` query param caps the page at 200; default is 50.
 */
export async function GET(request: NextRequest) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = Math.min(
    200,
    Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 50)),
  );

  try {
    const result = await pool.query(
      `SELECT id, tool_name, status, duration_ms, error_message, created_at
         FROM mcp_audit_log
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [userId, limit],
    );
    return NextResponse.json({ entries: result.rows });
  } catch (err) {
    // Likely "relation mcp_audit_log does not exist" — return empty so
    // the UI doesn't crash on a fresh DB that hasn't run migration 051.
    console.error("[mcp-audit] GET error:", err);
    return NextResponse.json({ entries: [] });
  }
}
