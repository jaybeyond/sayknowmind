import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/org-context";
import { checkAntiBot } from "@/lib/antibot";
import { parsePipeline } from "@/lib/ultrarag/parser";
import { executePipeline } from "@/lib/ultrarag/executor";
import { validatePipeline } from "@/lib/ultrarag/validator";
import { ErrorCode } from "@/lib/types";

/** POST /api/pipeline — Execute or validate an UltraRAG pipeline */
export async function POST(request: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }
  const { userId, organizationId } = ctx;

  const blocked = checkAntiBot(request, userId);
  if (blocked) return blocked;

  try {
    const body = await request.json();
    const { pipeline: pipelineStr, action } = body as { pipeline?: string; action?: "validate" | "execute" };

    if (!pipelineStr || typeof pipelineStr !== "string") {
      return NextResponse.json(
        { code: ErrorCode.SEARCH_INVALID_QUERY, message: "Pipeline definition is required", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    const { pipeline, errors } = parsePipeline(pipelineStr);

    if (!pipeline) {
      return NextResponse.json({ valid: false, errors }, { status: 400 });
    }

    if (action === "validate") {
      const validation = validatePipeline(pipeline);
      return NextResponse.json(validation);
    }

    // Execute pipeline with org context so executor can scope document queries.
    const result = await executePipeline(pipeline, { userId, organizationId });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[pipeline] Error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Pipeline execution failed", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
