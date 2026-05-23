import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/org-context";
import { orgScopeClause } from "@/lib/visibility";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";

/** GET /api/conversations/[id]/messages — Get messages for a conversation */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getOrgContext();
    if (!ctx) {
      return NextResponse.json(
        { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
        { status: 401 },
      );
    }

    const { id } = await params;

    // Verify conversation belongs to caller's org
    // $1 = conversation id, $2 = organizationId
    const convCheck = await pool.query(
      `SELECT c.id FROM conversations c
       WHERE c.id = $1 AND ${orgScopeClause("c", 2)}`,
      [id, ctx.organizationId],
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

/**
 * POST /api/conversations/[id]/messages — Append a message.
 *
 * Used by the lite-desktop OCP fast path in `chat-page.tsx`, which calls
 * the local proxy directly and bypasses /api/chat (the route that would
 * normally insert messages as a side effect). Accepts a single role +
 * content pair so the client can post the user turn and the assistant
 * turn separately as they're produced.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getOrgContext();
    if (!ctx) {
      return NextResponse.json(
        { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
        { status: 401 },
      );
    }

    const { id } = await params;

    // Verify conversation belongs to caller's org — prevents an authenticated
    // member from injecting messages into a conversation in another org by ID guess.
    // $1 = conversation id, $2 = organizationId
    const convCheck = await pool.query(
      `SELECT c.id FROM conversations c
       WHERE c.id = $1 AND ${orgScopeClause("c", 2)}`,
      [id, ctx.organizationId],
    );
    if (convCheck.rowCount === 0) {
      return NextResponse.json(
        { code: ErrorCode.CATEGORY_NOT_FOUND, message: "Conversation not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }

    let body: { role?: string; content?: string };
    try {
      body = (await request.json()) as { role?: string; content?: string };
    } catch {
      return NextResponse.json(
        { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "Invalid JSON body", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    const role = body.role;
    const content = typeof body.content === "string" ? body.content : "";
    if (role !== "user" && role !== "assistant" && role !== "system") {
      return NextResponse.json(
        { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "role must be 'user', 'assistant', or 'system'", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }
    if (!content || content.trim().length === 0) {
      return NextResponse.json(
        { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "content is required", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    // messages has no organization_id — parent conversation already verified above
    const result = await pool.query(
      `INSERT INTO messages (conversation_id, role, content)
       VALUES ($1, $2, $3)
       RETURNING id, role, content, created_at`,
      [id, role, content],
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err) {
    console.error("[conversations/messages] POST error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
