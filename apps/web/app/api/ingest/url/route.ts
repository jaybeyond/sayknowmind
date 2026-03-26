import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { checkAntiBot } from "@/lib/antibot";
import { fetchUrl } from "@/lib/ingest/url-fetcher";
import { detectLanguage } from "@/lib/ingest/language-detect";
import { insertDocument, assignDocumentCategory, findDuplicateByUrl, deduplicateName } from "@/lib/ingest/document-store";
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
    const { url, categoryId, tags, locale, force } = body as { url?: string; categoryId?: string; tags?: string[]; locale?: string; force?: boolean };

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { code: ErrorCode.INGEST_INVALID_URL, message: "URL is required", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    // Duplicate check
    if (!force) {
      const existing = await findDuplicateByUrl(userId, url);
      if (existing) {
        return NextResponse.json(
          { duplicate: true, existingId: existing.id, existingTitle: existing.title, message: "URL already saved" },
          { status: 409 },
        );
      }
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

    // Store document (rename title if force-saving duplicate)
    let title = fetched.title || new URL(url).hostname;
    if (force) {
      const dup = await findDuplicateByUrl(userId, url);
      if (dup) title = deduplicateName(dup.title);
    }
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

    // Assign to collection if specified
    if (categoryId) {
      await assignDocumentCategory(documentId, categoryId);
    }

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
