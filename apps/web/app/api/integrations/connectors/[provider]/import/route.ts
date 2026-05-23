/**
 * POST /api/integrations/connectors/:provider/import
 * Body JSON: {
 *   accountId: string,
 *   externalIds: string[],     // up to 50 per request
 *   categoryId?: string,
 *   locale?: "ko" | "en" | "ja" | "zh",
 * }
 *
 * Downloads each selected item from the user's connected account, runs it
 * through the same ingestion pipeline as /api/ingest/file (parser →
 * document insert → file save → async job), and records the import in
 * user_integration_imports so a re-import can be detected.
 *
 * Per-user isolation: the connector only accepts (userId, accountId)
 * tuples this user owns. A user cannot trigger an import on someone
 * else's tokens.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/admin";
import { getOrgContext } from "@/lib/org-context";
import { checkAntiBot } from "@/lib/antibot";
import { parseFile } from "@/lib/ingest/parsers";
import { detectLanguage } from "@/lib/ingest/language-detect";
import {
  insertDocument,
  updateDocument,
  assignDocumentCategory,
  findDuplicateByFileName,
  deduplicateName,
} from "@/lib/ingest/document-store";
import { saveFile } from "@/lib/ingest/file-storage";
import { createJob } from "@/lib/ingest/job-queue";
import { pool } from "@/lib/db";
import { getConnector } from "@/lib/integrations/connectors/registry";

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_BATCH = 50;

interface ImportResultItem {
  externalId: string;
  status: "imported" | "skipped" | "failed";
  documentId?: string;
  jobId?: string;
  reason?: string;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ provider: string }> },
) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgCtx = await getOrgContext();
  if (!orgCtx) {
    return NextResponse.json({ error: "No organization context" }, { status: 401 });
  }
  const organizationId = orgCtx.organizationId;

  // Rate limit (reuses the same anti-bot logic as /api/ingest/file)
  const blocked = checkAntiBot(req, userId);
  if (blocked) return blocked;

  const { provider } = await context.params;
  const connector = getConnector(provider);
  if (!connector) {
    return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 404 });
  }

  let body: {
    accountId?: string;
    externalIds?: string[];
    categoryId?: string;
    locale?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { accountId, externalIds, categoryId, locale } = body;
  if (!accountId || !Array.isArray(externalIds) || externalIds.length === 0) {
    return NextResponse.json({ error: "accountId and externalIds are required" }, { status: 400 });
  }
  if (externalIds.length > MAX_BATCH) {
    return NextResponse.json({ error: `Up to ${MAX_BATCH} items per import` }, { status: 400 });
  }

  const validLocales = ["ko", "en", "ja", "zh"] as const;
  const userLocale = (locale && validLocales.includes(locale as (typeof validLocales)[number]))
    ? (locale as (typeof validLocales)[number])
    : null;

  const results: ImportResultItem[] = [];

  for (const externalId of externalIds) {
    try {
      // Has this user already imported this exact item from this account?
      const dup = await pool.query(
        `SELECT document_id FROM user_integration_imports
         WHERE user_id = $1 AND provider = $2 AND account_id = $3 AND external_id = $4`,
        [userId, connector.meta.id, accountId, externalId],
      );
      if ((dup.rowCount ?? 0) > 0 && dup.rows[0].document_id) {
        results.push({
          externalId,
          status: "skipped",
          documentId: dup.rows[0].document_id,
          reason: "already_imported",
        });
        continue;
      }

      // Pull bytes/text from the provider using THIS user's tokens
      const downloaded = await connector.download({
        userId,
        accountId,
        externalId,
      });

      // Reuse the parser pipeline that /api/ingest/file uses
      let buffer: Buffer;
      let mimeType: string;
      let filename: string;
      if (downloaded.kind === "text") {
        buffer = Buffer.from(downloaded.text, "utf8");
        mimeType = downloaded.mimeType;
        filename = downloaded.filename;
      } else {
        buffer = downloaded.bytes;
        mimeType = downloaded.mimeType;
        filename = downloaded.filename;
      }

      if (buffer.length > MAX_FILE_SIZE) {
        results.push({
          externalId,
          status: "failed",
          reason: `exceeds_50MB`,
        });
        continue;
      }

      let parsed;
      try {
        parsed = await parseFile(buffer, mimeType, filename);
      } catch (err) {
        results.push({
          externalId,
          status: "failed",
          reason: `parse_failed: ${(err as Error).message}`,
        });
        continue;
      }

      const language = userLocale ?? detectLanguage(parsed.content);

      const isMedia = parsed.fileType === "image" || parsed.fileType === "video";
      const mediaBase64 = isMedia && buffer.length <= 10 * 1024 * 1024
        ? buffer.toString("base64")
        : undefined;

      // Avoid clashing names if the user happened to upload the same name before
      let savedFileName = filename;
      const existing = await findDuplicateByFileName(userId, filename, organizationId);
      if (existing) {
        savedFileName = deduplicateName(filename);
      }

      const title = parsed.title || savedFileName.replace(/\.[^.]+$/, "");
      const documentId = await insertDocument({
        userId,
        organizationId,
        title,
        content: parsed.content,
        sourceType: "file",
        metadata: {
          wordCount: parsed.wordCount,
          fileType: parsed.fileType,
          fileName: savedFileName,
          fileSize: buffer.length,
          doc_type: "file",
          language,
          source: {
            connector: connector.meta.id,
            accountId,
            externalId,
          },
          ...parsed.metadata,
          ...(mediaBase64 ? { fileBase64: mediaBase64 } : {}),
        },
      });

      try {
        const filePath = await saveFile(documentId, savedFileName, buffer);
        await updateDocument(documentId, { metadata: { filePath } });
      } catch (err) {
        console.warn(
          `[connectors/${connector.meta.id}/import] File save failed (ephemeral FS?):`,
          (err as Error).message,
        );
      }

      if (categoryId) {
        await assignDocumentCategory(documentId, categoryId);
      }

      const jobId = await createJob(userId, documentId, organizationId);

      // Record the import for de-duplication on the next browse
      await pool.query(
        `INSERT INTO user_integration_imports
           (user_id, provider, account_id, external_id, document_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, provider, account_id, external_id)
         DO UPDATE SET document_id = EXCLUDED.document_id, imported_at = NOW()`,
        [userId, connector.meta.id, accountId, externalId, documentId],
      );

      results.push({ externalId, status: "imported", documentId, jobId });
    } catch (err) {
      results.push({
        externalId,
        status: "failed",
        reason: (err as Error).message,
      });
    }
  }

  return NextResponse.json({
    provider: connector.meta.id,
    accountId,
    imported: results.filter((r) => r.status === "imported").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  });
}
