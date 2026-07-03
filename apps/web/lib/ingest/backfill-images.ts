import { pool } from "@/lib/db";
import { readableClause } from "@/lib/visibility";
import { getFile } from "./file-storage";
import { updateDocument } from "./document-store";
import { cacheOgImageForDocument } from "./og-image";

export interface BackfillResult {
  /** Rows examined this run. */
  scanned: number;
  /** Web/URL docs that gained a durable og-image (base64). */
  fixedOg: number;
  /** Uploaded image files whose bytes were recovered from disk into base64. */
  fixedFile: number;
  /** Docs with no recoverable image source (marked so future runs skip them). */
  unrecoverable: number;
}

interface Ctx {
  userId: string;
  organizationId: string | null;
}

/**
 * Backfill list-thumbnail images for the caller's readable documents.
 *
 * Railway (and other ephemeral-FS hosts) lose the `uploads/` disk on redeploy, so
 * the durable copy of a preview image is the base64 stored on the document row.
 * This finds docs that render a thumbnail but lack that durable copy and restores
 * it — re-downloading web og-images from source, or recovering an uploaded image's
 * bytes from disk while it's still present.
 *
 * Idempotent: fixed docs won't be re-selected (they now have base64), and docs with
 * no recoverable source are marked (`ogImageNone` / `fileBytesLost`) so repeated
 * runs converge instead of re-scraping the same dead pages.
 */
export async function backfillDocumentImages(
  ctx: Ctx,
  opts: { limit?: number; concurrency?: number } = {},
): Promise<BackfillResult> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);
  const concurrency = Math.min(Math.max(opts.concurrency ?? 5, 1), 8);

  const queryResult = await pool.query(
    `SELECT d.id, d.url, d.metadata
       FROM documents d
      WHERE ${readableClause("d", 2, 1, "document")}
        AND (
          -- web/url docs: no persisted og bytes, a source URL to fetch from, and
          -- not already known to have no og image
          (
            (d.metadata->>'ogImageBase64') IS NULL
            AND (d.metadata->>'ogImageNone') IS NULL
            AND (
              d.url ~* '^https?://'
              OR (d.metadata->>'ogImage') ~* '^https?://'
              OR (d.metadata->>'ogImageOriginal') ~* '^https?://'
            )
          )
          -- uploaded image files: no persisted bytes, a recorded disk path, and
          -- not already known to be lost
          OR (
            (d.metadata->>'fileType') = 'image'
            AND (d.metadata->>'fileBase64') IS NULL
            AND (d.metadata->>'filePath') IS NOT NULL
            AND (d.metadata->>'fileBytesLost') IS NULL
          )
        )
      ORDER BY d.created_at DESC
      LIMIT $3`,
    [ctx.userId, ctx.organizationId, limit],
  );
  const rows = queryResult.rows as Array<{
    id: string;
    url: string | null;
    metadata: Record<string, unknown> | null;
  }>;

  const result: BackfillResult = {
    scanned: rows.length,
    fixedOg: 0,
    fixedFile: 0,
    unrecoverable: 0,
  };

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const isImageFile =
        meta.fileType === "image" &&
        typeof meta.filePath === "string" &&
        typeof meta.fileBase64 !== "string";

      try {
        if (isImageFile) {
          // Recover the uploaded image's bytes from disk while it's still there.
          const file = await getFile(meta.filePath as string);
          if (file) {
            await updateDocument(row.id, {
              metadata: { fileBase64: file.buffer.toString("base64") },
            });
            result.fixedFile++;
          } else {
            // Ephemeral disk already reclaimed the original — nothing to recover.
            await updateDocument(row.id, { metadata: { fileBytesLost: true } }).catch(() => {});
            result.unrecoverable++;
          }
          continue;
        }

        // Web/URL doc — resolve + download + persist the og image (shared helper).
        const cached = await cacheOgImageForDocument(row.id, { url: row.url, metadata: meta });
        if (cached) {
          result.fixedOg++;
        } else {
          // No og image on the page — mark so we don't re-scrape it every run.
          await updateDocument(row.id, { metadata: { ogImageNone: true } }).catch(() => {});
          result.unrecoverable++;
        }
      } catch {
        result.unrecoverable++;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return result;
}
