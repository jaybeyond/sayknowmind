import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";

/** GET /api/conversations — List user's conversations */
export async function GET() {
  try {
    const userId = await getUserIdFromRequest();
    if (!userId) {
      return NextResponse.json(
        { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
        { status: 401 },
      );
    }

    const result = await pool.query(
      `SELECT id, title, created_at, updated_at
       FROM conversations
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT 50`,
      [userId],
    );

    return NextResponse.json({ conversations: result.rows });
  } catch (err) {
    console.error("[conversations] GET error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}

/**
 * POST /api/conversations — Create a new conversation row.
 *
 * Used by the lite-desktop OCP fast path: chat doesn't go through
 * `/api/chat` (which would create the conversation server-side as a side
 * effect), so the webview has to explicitly mint one here before posting
 * messages to /api/conversations/[id]/messages.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await getUserIdFromRequest();
    if (!userId) {
      return NextResponse.json(
        { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
        { status: 401 },
      );
    }

    let body: { title?: string } = {};
    try {
      body = (await request.json()) as { title?: string };
    } catch {
      /* title optional */
    }

    const title =
      typeof body.title === "string" && body.title.trim().length > 0
        ? body.title.slice(0, 500)
        : "New Conversation";

    const result = await pool.query(
      `INSERT INTO conversations (user_id, title)
       VALUES ($1, $2)
       RETURNING id, title, created_at, updated_at`,
      [userId, title],
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err) {
    console.error("[conversations] POST error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
