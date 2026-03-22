import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { checkAntiBot } from "@/lib/antibot";
import { fetchUrl } from "@/lib/ingest/url-fetcher";
import { detectLanguage } from "@/lib/ingest/language-detect";
import { insertDocument } from "@/lib/ingest/document-store";
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
    const { url, categoryId, tags, locale } = body as { url?: string; categoryId?: string; tags?: string[]; locale?: string };

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { code: ErrorCode.INGEST_INVALID_URL, message: "URL is required", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    // Fetch and parse URL content
    let fetched;
    try {
      fetched = await fetchUrl(url);
    } catch (err) {
      const error = err as Error & { code?: number };
      return NextResponse.json(
        {
          code: error.code ?? ErrorCode.INGEST_FETCH_FAILED,
          message: error.message,
          timestamp: new Date().toISOString(),
        },
        { status: 400 },
      );
    }

    // Use user locale if provided, otherwise detect from content
    const validLocales = ["ko", "en", "ja", "zh"] as const;
    const language = (locale && validLocales.includes(locale as typeof validLocales[number]))
      ? (locale as typeof validLocales[number])
      : detectLanguage(fetched.content);

    // Store document
    const title = fetched.title || new URL(url).hostname;
    const documentId = await insertDocument({
      userId,
      title,
      content: fetched.content,
      url,
      sourceType: "web",
      metadata: {
        wordCount: fetched.wordCount,
        language,
        categoryId,
        tags,
        ...fetched.metadata,
      },
    });

    // Create async processing job
    const jobId = await createJob(userId, documentId);

    return NextResponse.json({
      documentId,
      jobId,
      title,
      url,
      status: "pending",
    });
  } catch (err) {
    console.error("[ingest/url] Error:", err);
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
