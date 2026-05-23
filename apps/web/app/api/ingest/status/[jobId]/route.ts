import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/org-context";
import { orgScopeClause } from "@/lib/visibility";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  // Auth check
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const { jobId } = await params;

  if (!jobId) {
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Job ID is required", timestamp: new Date().toISOString() },
      { status: 400 },
    );
  }

  try {
    // orgScopeClause("j", 2) => "j.organization_id = $2"
    // $1 = jobId, $2 = organizationId
    const result = await pool.query(
      `SELECT j.id, j.status, j.progress, j.error_message
       FROM ingestion_jobs j
       WHERE j.id = $1 AND ${orgScopeClause("j", 2)}`,
      [jobId, ctx.organizationId],
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Job not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }

    const row = result.rows[0];
    return NextResponse.json({
      jobId: row.id,
      status: row.status,
      progress: row.progress,
      error: row.error_message ?? undefined,
    });
  } catch (err) {
    console.error("[ingest/status] Error:", err);
    return NextResponse.json(
      {
        code: ErrorCode.SYSTEM_INTERNAL_ERROR,
        message: "Internal server error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
