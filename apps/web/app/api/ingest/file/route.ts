import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { checkAntiBot } from "@/lib/antibot";
import { parseFile } from "@/lib/ingest/parsers";
import { detectLanguage } from "@/lib/ingest/language-detect";
import { insertDocument, assignDocumentCategory, findDuplicateByFileName, deduplicateName } from "@/lib/ingest/document-store";
import { saveFile } from "@/lib/ingest/file-storage";
import { createJob } from "@/lib/ingest/job-queue";
import { ErrorCode } from "@/lib/types";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB (images/videos need more)

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
    const categoryId = formData.get("categoryId") as string | null;
    const locale = formData.get("locale") as string | null;

    if (!file) {
      return NextResponse.json(
        { code: ErrorCode.INGEST_PARSE_FAILED, message: "No file provided", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    // Duplicate check
    const forceParam = formData.get("force") as string | null;
    if (forceParam !== "true") {
      const existing = await findDuplicateByFileName(userId, file.name);
      if (existing) {
        return NextResponse.json(
          { duplicate: true, existingId: existing.id, existingTitle: existing.title, message: "File already saved" },
          { status: 409 },
        );
      }
    }

    // Size check
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { code: ErrorCode.INGEST_PARSE_FAILED, message: "File exceeds 50MB limit", timestamp: new Date().toISOString() },
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

    // Use user locale if provided, otherwise detect from content
    const validLocales = ["ko", "en", "ja", "zh"] as const;
    const language = (locale && validLocales.includes(locale as typeof validLocales[number]))
      ? (locale as typeof validLocales[number])
      : detectLanguage(parsed.content);

    // For images/videos: store base64 in metadata for async vision analysis
    // Cap at 10 MB to avoid bloating the JSONB column on hosted DBs
    const isMedia = parsed.fileType === "image" || parsed.fileType === "video";
    const mediaBase64 = isMedia && buffer.length <= 10 * 1024 * 1024
      ? buffer.toString("base64")
      : undefined;

    // Rename if force-saving a duplicate
    let savedFileName = file.name;
    if (forceParam === "true") {
      const dup = await findDuplicateByFileName(userId, file.name);
      if (dup) savedFileName = deduplicateName(file.name);
    }

    // Store document immediately (vision analysis runs in background job)
    const title = parsed.title || savedFileName.replace(/\.[^.]+$/, "");
    const documentId = await insertDocument({
      userId,
      title,
      content: parsed.content,
      sourceType: "file",
      metadata: {
        wordCount: parsed.wordCount,
        fileType: parsed.fileType,
        fileName: savedFileName,
        fileSize: file.size,
        doc_type: "file",
        language,
        ...parsed.metadata,
        ...(mediaBase64 ? { fileBase64: mediaBase64 } : {}),
      },
    });

    // Save file to disk for preview/download (non-fatal on ephemeral filesystems)
    try {
      const filePath = await saveFile(documentId, savedFileName, buffer);
      await import("@/lib/ingest/document-store").then(({ updateDocument }) =>
        updateDocument(documentId, { metadata: { filePath } }),
      );
    } catch (err) {
      console.warn("[ingest/file] File storage failed (ephemeral FS?):", (err as Error).message);
    }

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
