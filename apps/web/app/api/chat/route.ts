import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { checkAntiBot } from "@/lib/antibot";
import { pool } from "@/lib/db";
import { queryEdgeQuake } from "@/lib/edgequake/client";
import { executeAgenticQuery } from "@/lib/agents/orchestrator";
import { ErrorCode } from "@/lib/types";
import type { ChatMode } from "@/lib/types";

const AI_SERVER_URL = process.env.AI_SERVER_URL ?? "http://localhost:4000";
const AI_API_KEY = process.env.AI_API_KEY ?? "";
const AI_TIMEOUT = 60_000;

export async function POST(request: NextRequest) {
  // Auth check
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  // Rate limiting
  const blocked = checkAntiBot(request, userId);
  if (blocked) return blocked;

  try {
    const body = await request.json();
    const {
      message,
      conversationId,
      mode = "simple",
      context,
    } = body as {
      message?: string;
      conversationId?: string;
      mode?: ChatMode;
      context?: { documentIds?: string[]; categoryIds?: string[] };
    };

    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return NextResponse.json(
        { code: ErrorCode.SEARCH_INVALID_QUERY, message: "Message is required", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    // Get or create conversation
    let convId = conversationId;
    if (!convId) {
      const convResult = await pool.query(
        `INSERT INTO conversations (user_id, title)
         VALUES ($1, $2) RETURNING id`,
        [userId, message.slice(0, 100)],
      );
      convId = convResult.rows[0].id;
    } else {
      // Verify conversation belongs to this user before appending messages
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

    // Gather context from documents if provided
    let contextText = "";
    if (context?.documentIds?.length) {
      const docsResult = await pool.query(
        `SELECT title, summary, content FROM documents
         WHERE id = ANY($1) AND user_id = $2`,
        [context.documentIds, userId],
      );
      contextText = docsResult.rows
        .map((r: { title: string; summary: string | null; content: string }) =>
          `[${r.title}]: ${r.summary || r.content.slice(0, 500)}`,
        )
        .join("\n\n");
    }

    // Try to get RAG context from EdgeQuake
    let ragContext = "";
    try {
      const eqResult = await queryEdgeQuake({
        query: message,
        mode: mode === "agentic" ? "hybrid" : "naive",
        include_references: true,
        max_results: 5,
      });
      if (eqResult.sources?.length) {
        ragContext = eqResult.sources
          .filter((s) => s.snippet)
          .map((s) => s.snippet)
          .join("\n\n");
      }
    } catch {
      // EdgeQuake unavailable — proceed without RAG context
    }

    // Build system prompt with context
    const systemParts = [
      "You are SayKnowMind, an intelligent knowledge assistant. Answer based on the user's knowledge base when relevant context is available.",
    ];
    if (ragContext) {
      systemParts.push(`\nRelevant context from knowledge base:\n${ragContext}`);
    }
    if (contextText) {
      systemParts.push(`\nUser-provided context:\n${contextText}`);
    }

    // Load conversation history (last 10 messages)
    const historyResult = await pool.query(
      `SELECT role, content FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC LIMIT 10`,
      [convId],
    );
    const history = historyResult.rows.reverse();

    // Agentic mode: multi-step reasoning with task decomposition
    if (mode === "agentic") {
      const agenticResult = await executeAgenticQuery(
        message,
        userId,
        history.map((m: { role: string; content: string }) => ({
          role: m.role,
          content: m.content,
        })),
      );

      // Store assistant message with agent steps
      await pool.query(
        `INSERT INTO messages (conversation_id, role, content, agent_steps)
         VALUES ($1, 'assistant', $2, $3)`,
        [convId, agenticResult.answer, JSON.stringify(agenticResult.steps)],
      );

      await pool.query(
        `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
        [convId],
      );

      return NextResponse.json({
        conversationId: convId,
        messageId: "",
        answer: agenticResult.answer,
        citations: agenticResult.citations,
        relatedDocuments: agenticResult.relatedDocuments,
        agentSteps: agenticResult.steps,
      });
    }

    // Check if streaming is requested
    const acceptsSSE = request.headers.get("accept")?.includes("text/event-stream");

    if (acceptsSSE) {
      return streamResponse(systemParts.join("\n"), history, convId!, userId);
    }

    // Non-streaming response via AI server
    const aiHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (AI_API_KEY) aiHeaders["Authorization"] = `Bearer ${AI_API_KEY}`;

    const aiResponse = await fetch(`${AI_SERVER_URL}/ai/chat`, {
      method: "POST",
      headers: aiHeaders,
      body: JSON.stringify({
        system: systemParts.join("\n"),
        message,
        messages: history.map((m: { role: string; content: string }) => ({
          role: m.role,
          content: m.content,
        })),
        userId,
        sessionId: convId,
      }),
      signal: AbortSignal.timeout(AI_TIMEOUT),
    });

    if (!aiResponse.ok) {
      throw new Error(`AI server returned ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const answer = aiData.response ?? aiData.message ?? aiData.content ?? "";

    // Store assistant message
    await pool.query(
      `INSERT INTO messages (conversation_id, role, content)
       VALUES ($1, 'assistant', $2)`,
      [convId, answer],
    );

    // Update conversation timestamp
    await pool.query(
      `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
      [convId],
    );

    return NextResponse.json({
      conversationId: convId,
      messageId: "", // Populated by DB
      answer,
      citations: [],
      relatedDocuments: [],
    });
  } catch (err) {
    console.error("[chat] Error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}

/** Stream response via SSE */
function streamResponse(
  systemPrompt: string,
  history: { role: string; content: string }[],
  conversationId: string,
  userId: string,
): NextResponse {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const aiHeaders: Record<string, string> = { "Content-Type": "application/json" };
        if (AI_API_KEY) aiHeaders["Authorization"] = `Bearer ${AI_API_KEY}`;

        const aiResponse = await fetch(`${AI_SERVER_URL}/ai/chat`, {
          method: "POST",
          headers: aiHeaders,
          body: JSON.stringify({
            system: systemPrompt,
            messages: history.map((m) => ({ role: m.role, content: m.content })),
            userId,
            sessionId: conversationId,
            stream: true,
          }),
          signal: AbortSignal.timeout(AI_TIMEOUT),
        });

        if (!aiResponse.ok || !aiResponse.body) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: "AI server error" })}\n\n`),
          );
          controller.close();
          return;
        }

        const reader = aiResponse.body.getReader();
        const decoder = new TextDecoder();
        let fullAnswer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          fullAnswer += chunk;

          // Forward as SSE
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ chunk, conversationId })}\n\n`),
          );
        }

        // Send done event
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ done: true, conversationId })}\n\n`),
        );

        // Store assistant message
        if (fullAnswer) {
          await pool.query(
            `INSERT INTO messages (conversation_id, role, content)
             VALUES ($1, 'assistant', $2)`,
            [conversationId, fullAnswer],
          );
          await pool.query(
            `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
            [conversationId],
          );
        }
      } catch (err) {
        console.error("[chat/stream] Error:", err);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
