import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { getJobStatus } from "@/lib/ingest/job-queue";
import { ErrorCode } from "@/lib/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  // Auth check
  const userId = await getUserIdFromRequest();
  if (!userId) {
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
    const status = await getJobStatus(jobId, userId);

    if (!status) {
      return NextResponse.json(
        { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Job not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }

    return NextResponse.json(status);
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
