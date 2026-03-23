import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";

/** GET /api/conversations/[id]/messages — Get messages for a conversation */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const userId = await getUserIdFromRequest();
    if (!userId) {
      return NextResponse.json(
        { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
        { status: 401 },
      );
    }

    const { id } = await params;

    // Verify conversation belongs to user
    const convCheck = await pool.query(
      `SELECT id FROM conversations WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    if (convCheck.rowCount === 0) {
      return NextResponse.json(
        { code: ErrorCode.CATEGORY_NOT_FOUND, message: "Conversation not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }

    const result = await pool.query(
      `SELECT id, role, content, citations, agent_steps, created_at
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [id],
    );

    return NextResponse.json({ messages: result.rows });
  } catch (err) {
    console.error("[conversations/messages] GET error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
