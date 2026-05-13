/**
 * POST /api/llm-relay/respond
 *
 * Webview side of the relay handshake: hand back the local LLM result
 * (or error) for a job previously claimed via /api/llm-relay/poll.
 * `lib/llm-relay/queue.ts` then resolves the cloud-side awaiter
 * (callCloudProvider / cloudStreamChat) and the request continues as
 * if the cloud had made the LLM call itself.
 *
 * Body (success):
 *   { id: string, content: string, model?: string }
 * Body (failure):
 *   { id: string, error: string }
 *
 * 404 means the job was unknown (already responded, timed out, or
 * served to a different webview after a reconnect).
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { completeJob, failJob } from "@/lib/llm-relay/queue";
import { ErrorCode } from "@/lib/types";

export const dynamic = "force-dynamic";

interface RespondBody {
  id?: string;
  content?: string;
  model?: string;
  error?: string;
}

export async function POST(request: NextRequest) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  let body: RespondBody;
  try {
    body = (await request.json()) as RespondBody;
  } catch {
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "Invalid JSON body", timestamp: new Date().toISOString() },
      { status: 400 },
    );
  }

  const id = typeof body.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "id is required", timestamp: new Date().toISOString() },
      { status: 400 },
    );
  }

  if (typeof body.error === "string" && body.error.length > 0) {
    const ok = failJob(userId, id, body.error);
    if (!ok) {
      return NextResponse.json(
        { code: ErrorCode.SEARCH_NO_RESULTS, message: "Job not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  }

  const content = typeof body.content === "string" ? body.content : "";
  if (!content) {
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "content is required when error is absent", timestamp: new Date().toISOString() },
      { status: 400 },
    );
  }

  const ok = completeJob(userId, id, {
    content,
    model: typeof body.model === "string" && body.model.length > 0 ? body.model : "local",
  });
  if (!ok) {
    return NextResponse.json(
      { code: ErrorCode.SEARCH_NO_RESULTS, message: "Job not found", timestamp: new Date().toISOString() },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
