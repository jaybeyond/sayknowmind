import { NextRequest, NextResponse } from "next/server";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { checkAntiBot } from "@/lib/antibot";
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
    const { url, title, content, html, tags } = body as {
      url?: string;
      title?: string;
      content?: string;
      html?: string;
      tags?: string[];
    };

    if (!url || typeof url !== "string") {
      return NextResponse.json(
        { code: ErrorCode.INGEST_INVALID_URL, message: "URL is required", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    // Extract content: prefer HTML parsing via Readability, fall back to provided content
    let extractedContent = content ?? "";
    let extractedTitle = title ?? "";

    if (html) {
      try {
        const dom = new JSDOM(html, { url });
        const reader = new Readability(dom.window.document);
        const article = reader.parse();
        if (article && article.textContent) {
          extractedContent = article.textContent.trim();
          extractedTitle = extractedTitle || article.title || "";
        }
      } catch {
        // Fall back to provided content
      }
    }

    if (!extractedContent || extractedContent.trim().length === 0) {
      return NextResponse.json(
        { code: ErrorCode.INGEST_PARSE_FAILED, message: "No content could be extracted", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    // Detect language
    const language = detectLanguage(extractedContent);

    // Count words
    const cjk = extractedContent.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g);
    const latin = extractedContent.match(/[a-zA-Z0-9]+/g);
    const wordCount = (cjk?.length ?? 0) + (latin?.length ?? 0);

    // Fallback title
    if (!extractedTitle) {
      try {
        extractedTitle = new URL(url).hostname;
      } catch {
        extractedTitle = "Untitled";
      }
    }

    // Store document
    const documentId = await insertDocument({
      userId,
      title: extractedTitle,
      content: extractedContent.trim(),
      url,
      sourceType: "browser_extension",
      metadata: {
        wordCount,
        language,
        tags,
      },
    });

    // Create async processing job
    const jobId = await createJob(userId, documentId);

    return NextResponse.json({
      documentId,
      jobId,
      title: extractedTitle,
      url,
      status: "pending",
    });
  } catch (err) {
    console.error("[ingest/extension] Error:", err);
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
