import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { checkAntiBot } from "@/lib/antibot";
import { pool } from "@/lib/db";
import { runPipeline } from "@/lib/agents/pipeline";
import { StreamWriter } from "@/lib/agents/stream-writer";
import { ErrorCode } from "@/lib/types";

export async function POST(request: NextRequest) {
  try {
    const userId = await getUserIdFromRequest();
    if (!userId) {
      return NextResponse.json(
        { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
        { status: 401 },
      );
    }

    const blocked = checkAntiBot(request, userId);
    if (blocked) return blocked;

    const body = await request.json();
    const { message, conversationId: reqConvId } = body as {
      message?: string;
      conversationId?: string;
    };

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return NextResponse.json(
        { code: ErrorCode.SEARCH_INVALID_QUERY, message: "Message is required", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    // Get or create conversation
    let convId = reqConvId;
    if (!convId) {
      const convResult = await pool.query(
        `INSERT INTO conversations (user_id, title)
         VALUES ($1, $2) RETURNING id`,
        [userId, message.slice(0, 100)],
      );
      convId = convResult.rows[0].id;
    } else {
      const ownerCheck = await pool.query(
        `SELECT id FROM conversations WHERE id = $1 AND user_id = $2`,
        [convId, userId],
      );
      if (ownerCheck.rowCount === 0) {
        return NextResponse.json(
          { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Conversation not found", timestamp: new Date().toISOString() },
          { status: 404 },
        );
      }
    }

    // Store user message
    await pool.query(
      `INSERT INTO messages (conversation_id, role, content)
       VALUES ($1, 'user', $2)`,
      [convId, message],
    );

    // Load conversation history (last 10 messages)
    const historyResult = await pool.query(
      `SELECT role, content FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC LIMIT 10`,
      [convId],
    );
    const history = historyResult.rows.reverse();

    // Always stream — create SSE response with pipeline
    const stream = new ReadableStream({
      start(controller) {
        const writer = new StreamWriter(controller);
        runPipeline({
          message,
          conversationId: convId!,
          userId,
          history,
          writer,
        });
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    console.error("[chat] Error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
