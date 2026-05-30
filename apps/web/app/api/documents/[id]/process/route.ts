import { NextRequest, NextResponse } from "next/server";
import { getOrgContext, isOrgAdmin } from "@/lib/org-context";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";
import { writableClause, editableViaShareClause } from "@/lib/visibility";
import { createJob } from "@/lib/ingest/job-queue";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/documents/:id/process
 *
 * Queues the standard ingestion job for a document — which generates a summary,
 * extracts entities, embeds the content and syncs it to EdgeQuake (vector +
 * knowledge graph). Used to bring editor-authored docs/mind maps into semantic
 * RAG, and to (re)generate their summary on demand.
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const { id } = await context.params;

  try {
    // params: $1 = id, $2 = userId, $3 = organizationId
    const check = await pool.query(
      `SELECT id FROM documents
        WHERE id = $1 AND (${writableClause("documents", 3, 2, isOrgAdmin(ctx.role))} OR ${editableViaShareClause("documents", 2, "document")})`,
      [id, ctx.userId, ctx.organizationId],
    );
    if (check.rows.length === 0) {
      return NextResponse.json(
        { code: ErrorCode.SEARCH_NO_RESULTS, message: "Document not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }

    const jobId = await createJob(ctx.userId, id, ctx.organizationId);
    return NextResponse.json({ jobId }, { status: 202 });
  } catch (err) {
    console.error("[documents] process error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
