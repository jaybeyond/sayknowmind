import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { checkAntiBot } from "@/lib/antibot";
import {
  insertDocument,
  assignDocumentCategory,
  findDuplicateByUrl,
} from "@/lib/ingest/document-store";
import { createJob } from "@/lib/ingest/job-queue";
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

    // Resolve folder names → category IDs (create if needed)
    const folderCategoryMap = new Map<string, string>();
    const uniqueFolders = [...new Set(bookmarks.map((b) => b.folder).filter(Boolean))];

    for (const folder of uniqueFolders) {
      // Use the leaf folder name as category name
      const categoryName = folder.includes("/") ? folder.split("/").pop()! : folder;

      const existing = await pool.query(
        `SELECT id FROM categories WHERE user_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
        [userId, categoryName],
      );

      if (existing.rows.length > 0) {
        folderCategoryMap.set(folder, existing.rows[0].id);
      } else {
        const created = await pool.query(
          `INSERT INTO categories (user_id, name) VALUES ($1, $2) RETURNING id`,
          [userId, categoryName],
        );
        folderCategoryMap.set(folder, created.rows[0].id);
      }
    }

    // Import bookmarks
    let imported = 0;
    let skipped = 0;
    const jobIds: string[] = [];

    for (const bookmark of bookmarks) {
      // Duplicate check
      if (skipDuplicates) {
        const dup = await findDuplicateByUrl(userId, bookmark.url);
        if (dup) {
          skipped++;
          continue;
        }
      }

      const documentId = await insertDocument({
        userId,
        title: bookmark.title,
        content: "",
        url: bookmark.url,
        sourceType: "web",
        metadata: {
          doc_type: "web",
          language: locale ?? undefined,
          tags: bookmark.tags.length > 0 ? bookmark.tags : undefined,
          bookmarkFolder: bookmark.folder || undefined,
          bookmarkAddDate: bookmark.addDate?.toISOString(),
          importedFrom: "bookmark-file",
        },
      });

      // Assign to folder category or explicit categoryId
      const catId = (bookmark.folder && folderCategoryMap.get(bookmark.folder)) || categoryId;
      if (catId) {
        await assignDocumentCategory(documentId, catId);
      }

      const jobId = await createJob(userId, documentId);
      jobIds.push(jobId);
      imported++;
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
