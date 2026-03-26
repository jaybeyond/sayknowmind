import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { checkAntiBot } from "@/lib/antibot";
import { detectLanguage } from "@/lib/ingest/language-detect";
import { insertDocument, assignDocumentCategory } from "@/lib/ingest/document-store";
import { createJob } from "@/lib/ingest/job-queue";
import { ErrorCode } from "@/lib/types";

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
    const { title, content, tags, categoryId, locale } = body as {
      title?: string;
      content?: string;
      tags?: string[];
      categoryId?: string;
      locale?: string;
    };

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return NextResponse.json(
        { code: ErrorCode.INGEST_PARSE_FAILED, message: "Content is required", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    // Use user locale if provided, otherwise detect from content
    const validLocales = ["ko", "en", "ja", "zh"] as const;
    const language = (locale && validLocales.includes(locale as typeof validLocales[number]))
      ? (locale as typeof validLocales[number])
      : detectLanguage(content);

    // Count words
    const cjk = content.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g);
    const latin = content.match(/[a-zA-Z0-9]+/g);
    const wordCount = (cjk?.length ?? 0) + (latin?.length ?? 0);

    // Store document
    const docTitle = title || content.slice(0, 80).trim() + (content.length > 80 ? "..." : "");
    const documentId = await insertDocument({
      userId,
      title: docTitle,
      content: content.trim(),
      sourceType: "text",
      metadata: {
        wordCount,
        language,
        tags,
      },
    });

    // Assign to collection if specified
    if (categoryId) {
      await assignDocumentCategory(documentId, categoryId);
    }

    // Create async processing job
    const jobId = await createJob(userId, documentId);

    return NextResponse.json({
      documentId,
      jobId,
      title: docTitle,
      status: "pending",
    });
  } catch (err) {
    console.error("[ingest/text] Error:", err);
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
