/**
 * POST /api/documents/[id]/apply-summary
 *
 * Client-driven counterpart to `job-queue.ts` step 1 (structured metadata).
 * The lite-desktop webview, when OCP is reachable on the user's machine,
 * runs the structured-metadata prompt against the local proxy and posts
 * the parsed result here. We persist exactly the same fields the cloud
 * job would have written: title, summary, metadata.{summary,
 * what_it_solves, key_points, aiTags, reading_time_minutes, language},
 * plus tag rows in `document_tags`. The cloud job's own metadata step is
 * skipped when it sees summary already filled, so this avoids burning a
 * paid OpenRouter call after OCP has already done the work for $0.
 */

import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pool } from "@/lib/db";
import { updateDocument } from "@/lib/ingest/document-store";
import { assignTags } from "@/lib/tags/store";
import { ErrorCode } from "@/lib/types";

type RouteContext = { params: Promise<{ id: string }> };

interface ClientSummaryBody {
  title?: string;
  summary?: string;
  what_it_solves?: string;
  key_points?: string[];
  tags?: string[];
  reading_time_minutes?: number;
  language?: string;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const { id } = await context.params;

  // Ownership check — apply-summary writes title/summary which a malicious
  // request could otherwise vandalize on a doc owned by a different user.
  const owner = await pool.query(
    `SELECT id FROM documents WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (owner.rowCount === 0) {
    return NextResponse.json(
      { code: ErrorCode.SEARCH_NO_RESULTS, message: "Document not found", timestamp: new Date().toISOString() },
      { status: 404 },
    );
  }

  let body: ClientSummaryBody;
  try {
    body = (await request.json()) as ClientSummaryBody;
  } catch {
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "Invalid JSON body", timestamp: new Date().toISOString() },
      { status: 400 },
    );
  }

  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  if (!summary) {
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "summary is required", timestamp: new Date().toISOString() },
      { status: 400 },
    );
  }

  const title = typeof body.title === "string" ? body.title.slice(0, 120) : undefined;
  const aiTags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 5)
    : [];
  const keyPoints = Array.isArray(body.key_points)
    ? body.key_points.filter((k): k is string => typeof k === "string").slice(0, 7)
    : [];
  const what_it_solves = typeof body.what_it_solves === "string" ? body.what_it_solves : "";
  const reading_time_minutes =
    typeof body.reading_time_minutes === "number" && Number.isFinite(body.reading_time_minutes)
      ? Math.max(1, Math.round(body.reading_time_minutes))
      : 1;
  const language = typeof body.language === "string" ? body.language : undefined;

  await updateDocument(id, {
    title: title || undefined,
    summary,
    metadata: {
      summary,
      what_it_solves,
      key_points: keyPoints,
      aiTags,
      reading_time_minutes,
      ...(language ? { language } : {}),
      // Marker so the cloud job-queue knows summary was already filled by
      // the client and can skip its own LLM call.
      ocp_summary_applied: true,
    },
  });

  if (aiTags.length > 0) {
    await assignTags(userId, id, aiTags);
  }

  return NextResponse.json({ ok: true, id });
}
