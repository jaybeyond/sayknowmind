/**
 * GET /api/llm-relay/poll
 *
 * Long-poll endpoint. The user's running webview keeps a request open
 * here; when the cloud needs an LLM call routed to that user's local
 * OCP/Codex, `lib/llm-relay/queue.ts` resolves the poll with the next
 * job. Webview executes it via Tauri (complete_via_ocp /
 * complete_via_codex) and POSTs the result to /api/llm-relay/respond.
 *
 * Response shapes:
 *   200 { job: { id, system, user, model, provider } }
 *       — webview should run it and POST result/error.
 *   204 (no body)
 *       — no job within the long-poll window; webview reconnects.
 *   401, 5xx — standard.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pollNextJob } from "@/lib/llm-relay/queue";
import { ErrorCode } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // give long-poll headroom over Next's default

export async function GET(request: NextRequest) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  // NextRequest exposes request.signal — fires when the client (webview)
  // aborts, e.g. on tab close. queue.ts uses this to drop the poller.
  const job = await pollNextJob(userId, request.signal);
  if (!job) {
    return new NextResponse(null, { status: 204 });
  }

  return NextResponse.json({
    job: {
      id: job.id,
      provider: job.request.provider,
      system: job.request.system,
      user: job.request.user,
      model: job.request.model,
    },
  });
}
