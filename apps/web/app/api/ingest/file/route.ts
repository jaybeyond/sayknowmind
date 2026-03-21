import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { checkAntiBot } from "@/lib/antibot";
import { parseFile } from "@/lib/ingest/parsers";
import { detectLanguage } from "@/lib/ingest/language-detect";
import { insertDocument } from "@/lib/ingest/document-store";
import { createJob } from "@/lib/ingest/job-queue";
import { ErrorCode } from "@/lib/types";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

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
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { code: ErrorCode.INGEST_PARSE_FAILED, message: "No file provided", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    // Size check
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { code: ErrorCode.INGEST_PARSE_FAILED, message: "File exceeds 10MB limit", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    // Parse file
    const buffer = Buffer.from(await file.arrayBuffer());
    let parsed;
    try {
      parsed = await parseFile(buffer, file.type, file.name);
    } catch (err) {
      const error = err as Error & { code?: number };
      return NextResponse.json(
        {
          code: error.code ?? ErrorCode.INGEST_PARSE_FAILED,
          message: error.message,
          timestamp: new Date().toISOString(),
        },
        { status: 400 },
      );
    }

    // Detect language
    const language = detectLanguage(parsed.content);

    // Store document
    const title = parsed.title || file.name.replace(/\.[^.]+$/, "");
    const documentId = await insertDocument({
      userId,
      title,
      content: parsed.content,
      sourceType: "file",
      metadata: {
        wordCount: parsed.wordCount,
        fileType: parsed.fileType,
        fileSize: file.size,
        language,
        ...parsed.metadata,
      },
    });

    // Create async processing job
    const jobId = await createJob(userId, documentId);

    return NextResponse.json({
      documentId,
      jobId,
      title,
      status: "pending",
    });
  } catch (err) {
    console.error("[ingest/file] Error:", err);
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
