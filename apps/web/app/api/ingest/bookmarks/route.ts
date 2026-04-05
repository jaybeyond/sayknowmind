import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { checkAntiBot } from "@/lib/antibot";
import {
  insertDocument,
  assignDocumentCategory,
  findDuplicateByUrl,
  updateDocument,
} from "@/lib/ingest/document-store";
import { createJob } from "@/lib/ingest/job-queue";
import { fetchUrl } from "@/lib/ingest/url-fetcher";
import { downloadOgImage } from "@/lib/ingest/file-storage";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";
import { parseBookmarkHtml, isBookmarkHtml } from "@/lib/ingest/bookmark-parser";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB — bookmark files are text, rarely large

export async function POST(request: NextRequest) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const blocked = checkAntiBot(request, userId);
  if (blocked) return blocked;

  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const categoryId = formData.get("categoryId") as string | null;
    const locale = formData.get("locale") as string | null;
    const skipDuplicates = formData.get("skipDuplicates") !== "false"; // default true

    if (!file) {
      return NextResponse.json(
        { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "File is required", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "File too large (max 20 MB)", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const html = buffer.toString("utf-8");

    if (!isBookmarkHtml(html)) {
      return NextResponse.json(
        { code: ErrorCode.INGEST_UNSUPPORTED_FORMAT, message: "Not a valid bookmark HTML file", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    const bookmarks = parseBookmarkHtml(html);
    if (bookmarks.length === 0) {
      return NextResponse.json(
        { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "No bookmarks found in file", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    // Narrow userId for closures (already null-checked above)
    const uid = userId as string;

    // Resolve folder names → category IDs (create if needed)
    const folderCategoryMap = new Map<string, string>();
    const uniqueFolders = [...new Set(bookmarks.map((b) => b.folder).filter(Boolean))];

    for (const folder of uniqueFolders) {
      const categoryName = folder.includes("/") ? folder.split("/").pop()! : folder;

      const existing = await pool.query(
        `SELECT id FROM categories WHERE user_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
        [uid, categoryName],
      );

      if (existing.rows.length > 0) {
        folderCategoryMap.set(folder, existing.rows[0].id);
      } else {
        const path = folder.replace(/\//g, ".");
        const created = await pool.query(
          `INSERT INTO categories (user_id, name, path) VALUES ($1, $2, $3) RETURNING id`,
          [uid, categoryName, path],
        );
        folderCategoryMap.set(folder, created.rows[0].id);
      }
    }

    // Import bookmarks in parallel batches
    let imported = 0;
    let skipped = 0;
    const jobIds: string[] = [];
    const BATCH_SIZE = 10;

    async function importOne(bookmark: typeof bookmarks[number]): Promise<void> {
      if (skipDuplicates) {
        const dup = await findDuplicateByUrl(uid, bookmark.url);
        if (dup) {
          skipped++;
          return;
        }
      }

      // Fetch actual page content (best-effort — skip on failure)
      let content = "";
      let fetchedMeta: Record<string, unknown> = {};
      try {
        const fetched = await fetchUrl(bookmark.url);
        content = fetched.content;
        fetchedMeta = {
          wordCount: fetched.wordCount,
          ...fetched.metadata,
        };
      } catch {
        // URL unreachable — save bookmark anyway with empty content
      }

      const documentId = await insertDocument({
        userId: uid,
        title: bookmark.title || (fetchedMeta.title as string) || bookmark.url,
        content,
        url: bookmark.url,
        sourceType: "web",
        metadata: {
          doc_type: "web",
          language: locale ?? undefined,
          tags: bookmark.tags.length > 0 ? bookmark.tags : undefined,
          bookmarkFolder: bookmark.folder || undefined,
          bookmarkAddDate: bookmark.addDate?.toISOString(),
          importedFrom: "bookmark-file",
          ...fetchedMeta,
        },
      });

      // Download OG image (non-blocking)
      const ogImage = fetchedMeta.ogImage as string | undefined;
      if (ogImage) {
        downloadOgImage(documentId, ogImage).then(async (result) => {
          if (result) {
            await updateDocument(documentId, {
              metadata: {
                ogImage: `/api/og/${documentId}`,
                ogImageBase64: result.base64,
                ogImageContentType: result.contentType,
              },
            });
          }
        }).catch(() => {});
      }

      const catId = (bookmark.folder && folderCategoryMap.get(bookmark.folder)) || categoryId;
      if (catId) {
        await assignDocumentCategory(documentId, catId);
      }

      const jobId = await createJob(uid, documentId);
      jobIds.push(jobId);
      imported++;
    }

    // Process in batches of BATCH_SIZE for controlled parallelism
    for (let i = 0; i < bookmarks.length; i += BATCH_SIZE) {
      const batch = bookmarks.slice(i, i + BATCH_SIZE);
      await Promise.allSettled(batch.map(importOne));
    }

    return NextResponse.json({
      total: bookmarks.length,
      imported,
      skipped,
      folders: uniqueFolders,
      jobIds,
    });
  } catch (err) {
    console.error("[ingest/bookmarks] Error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
