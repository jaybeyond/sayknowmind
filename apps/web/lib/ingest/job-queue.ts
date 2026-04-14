import { pool } from "@/lib/db";
import type { IngestStatus, IngestStatusResponse } from "@/lib/types";
import { getDocument, updateDocument, insertEntities, assignDocumentCategory } from "./document-store";
import { generateSummary, extractEntities, suggestCategories, generateStructuredMetadata, describeImage, describeVideoFrame, type StructuredMetadata } from "./ai-processor";
import { indexDocument, queryEdgeQuake } from "@/lib/edgequake/client";
import { createNotification } from "@/lib/notifications";
import { detectLanguage } from "./language-detect";
import { emitDocumentEvent } from "@/lib/events";
// usage-limit import removed — ingestion no longer counted against daily limit

interface JobRow {
  id: string;
  user_id: string;
  document_id: string;
  status: IngestStatus;
  progress: number;
  error_message: string | null;
  retry_count: number;
  max_retries: number;
}

export async function createJob(userId: string, documentId: string): Promise<string> {
  const result = await pool.query(
    `INSERT INTO ingestion_jobs (user_id, document_id)
     VALUES ($1, $2)
     RETURNING id`,
    [userId, documentId],
  );
  const jobId = result.rows[0].id;

  // Notify connected SSE clients about the new document
  emitDocumentEvent({ type: "document:created", documentId, userId, jobId });

  // Start processing asynchronously (fire and forget)
  processJobById(jobId).catch((err) => {
    console.error(`[job-queue] Unhandled error processing job ${jobId}:`, err);
  });

  return jobId;
}

export async function getJobStatus(
  jobId: string,
  userId: string,
): Promise<IngestStatusResponse | null> {
  const result = await pool.query(
    `SELECT id, status, progress, error_message FROM ingestion_jobs
     WHERE id = $1 AND user_id = $2`,
    [jobId, userId],
  );

  if (result.rows.length === 0) return null;

  const row = result.rows[0];
  return {
    jobId: row.id,
    status: row.status,
    progress: row.progress,
    error: row.error_message ?? undefined,
  };
}

async function updateJobProgress(
  jobId: string,
  progress: number,
  status?: IngestStatus,
): Promise<void> {
  await pool.query(
    `UPDATE ingestion_jobs
     SET progress = $1, status = COALESCE($2, status), updated_at = NOW()
     WHERE id = $3`,
    [progress, status ?? null, jobId],
  );
}

async function failJob(jobId: string, errorMessage: string): Promise<void> {
  await pool.query(
    `UPDATE ingestion_jobs
     SET status = 'failed', error_message = $1, updated_at = NOW()
     WHERE id = $2`,
    [errorMessage, jobId],
  );
}

async function completeJob(jobId: string): Promise<void> {
  await pool.query(
    `UPDATE ingestion_jobs
     SET status = 'completed', progress = 100, updated_at = NOW(), completed_at = NOW()
     WHERE id = $1`,
    [jobId],
  );
}

async function getJob(jobId: string): Promise<JobRow | null> {
  const result = await pool.query(
    `SELECT * FROM ingestion_jobs WHERE id = $1`,
    [jobId],
  );
  return result.rows[0] ?? null;
}

async function processJobById(jobId: string): Promise<void> {
  const job = await getJob(jobId);
  if (!job) return;

  await processJob(job);
}

async function processJob(job: JobRow): Promise<void> {
  const { id: jobId, document_id: documentId, user_id: userId } = job;

  try {
    await updateJobProgress(jobId, 10, "processing");

    // Fetch the document
    const doc = await getDocument(documentId);
    if (!doc) {
      await failJob(jobId, "Document not found");
      return;
    }

    // Note: ingestion is not counted against daily AI limit.
    // Only chat completions consume the daily free quota.

    // Resolve language: user DB locale > document metadata > content detection
    const meta = (doc.metadata ?? {}) as Record<string, unknown>;
    const validLangs = ["ko", "en", "ja", "zh"] as const;
    let language: typeof validLangs[number] = "en";
    try {
      const userRow = await pool.query(`SELECT locale FROM "user" WHERE id = $1`, [userId]);
      const userLocale = userRow.rows[0]?.locale as string | undefined;
      if (userLocale && validLangs.includes(userLocale as typeof validLangs[number])) {
        language = userLocale as typeof validLangs[number];
      }
    } catch { /* fallback */ }
    if (language === "en") {
      const storedLang = typeof meta.language === "string" ? meta.language : "";
      if (validLangs.includes(storedLang as typeof validLangs[number])) {
        language = storedLang as typeof validLangs[number];
      } else {
        language = detectLanguage(doc.content);
      }
    }
    await updateJobProgress(jobId, 15);

    // Step 0: Vision analysis for images/videos (saved first, analyzed now)
    const fileType = typeof meta.fileType === "string" ? meta.fileType : "";
    const fileBase64 = typeof meta.fileBase64 === "string" ? meta.fileBase64 : "";
    if ((fileType === "image" || fileType === "video") && fileBase64) {
      // Keep base64 for preview if small enough (< 2MB base64 ≈ 1.5MB original)
      const keepBase64 = fileBase64.length < 2 * 1024 * 1024;
      const clearMeta = keepBase64
        ? { visionAnalyzed: true }
        : { visionAnalyzed: true, fileBase64: null };

      try {
        const result = fileType === "image"
          ? await describeImage(fileBase64, language)
          : await describeVideoFrame(fileBase64, language);

        // Only update if vision returned actual content — don't overwrite with empty
        if (result.content && result.content.trim().length > 0) {
          await updateDocument(documentId, {
            title: result.title || doc.title,
            content: result.content,
            metadata: clearMeta,
          });
          doc.content = result.content;
          doc.title = result.title || doc.title;
        } else {
          console.warn(`[job-queue] Vision returned empty for job ${jobId} — keeping original content`);
          await updateDocument(documentId, { metadata: clearMeta });
        }
      } catch (err) {
        console.warn(`[job-queue] Vision analysis failed for job ${jobId}, continuing with original content:`, err);
        await updateDocument(documentId, { metadata: clearMeta });
      }
      await updateJobProgress(jobId, 20);
    }

    // Step 1: Generate structured metadata via AI (20% → 50%)
    let structuredMeta: StructuredMetadata = {
      title: "", summary: "", what_it_solves: "", key_points: [], aiTags: [], reading_time_minutes: 1,
    };
    try {
      const wordCount = doc.content ? doc.content.split(/\s+/).length : 0;
      structuredMeta = await generateStructuredMetadata(doc.content ?? "", language, wordCount);

      await updateDocument(documentId, {
        title: structuredMeta.title || undefined,
        summary: structuredMeta.summary || undefined,
        metadata: {
          summary: structuredMeta.summary,
          what_it_solves: structuredMeta.what_it_solves,
          key_points: structuredMeta.key_points,
          aiTags: structuredMeta.aiTags,
          reading_time_minutes: structuredMeta.reading_time_minutes,
          language,
        },
      });
    } catch (err) {
      console.error(`[job-queue] Structured metadata generation failed for job ${jobId}:`, err);
    }
    await updateJobProgress(jobId, 50);

    // Step 2: Extract entities (40% → 70%)
    let entityCount = 0;
    try {
      const entities = await extractEntities(doc.content, language);
      entityCount = entities.length;
      if (entities.length > 0) {
        await insertEntities(
          entities.map((e) => ({
            documentId,
            name: e.name,
            type: e.type,
            confidence: e.confidence,
          })),
        );
      }
    } catch (err) {
      console.error(`[job-queue] Entity extraction failed for job ${jobId}:`, err);
    }
    await updateJobProgress(jobId, 70);

    // Step 3: Suggest categories (70% → 90%)
    try {
      // Fetch user's existing categories
      const catResult = await pool.query(
        `SELECT id, name FROM categories WHERE user_id = $1`,
        [userId],
      );
      const existingCategories = catResult.rows.map((r: { id: string; name: string }) => ({
        id: r.id,
        name: r.name,
      }));

      const suggestions = await suggestCategories(doc.content, userId, existingCategories, language);

      // Auto-assign categories based on AI suggestions
      let newCategoryCreated = false;
      for (const suggestion of suggestions) {
        // Existing categories: 0.5 threshold, new categories: 0.8 threshold
        const isNew = suggestion.categoryId === "new";
        if (suggestion.confidence < (isNew ? 0.8 : 0.5)) continue;

        let categoryId = suggestion.categoryId;

        // Create new category if AI suggests one that doesn't exist (max 1 per document)
        if (isNew && suggestion.categoryName && !newCategoryCreated) {
          // Check if a similar category already exists (case-insensitive)
          const similar = existingCategories.find(
            (c: { id: string; name: string }) => c.name.toLowerCase() === suggestion.categoryName.toLowerCase(),
          );
          if (similar) {
            categoryId = similar.id;
          } else {
            const insertResult = await pool.query(
              `INSERT INTO categories (user_id, name, depth, path)
               VALUES ($1, $2, 0, $3::text)
               ON CONFLICT (user_id, name, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'))
               DO UPDATE SET name = EXCLUDED.name
               RETURNING id`,
              [userId, suggestion.categoryName, suggestion.categoryName],
            );
            categoryId = insertResult.rows[0]?.id;
            newCategoryCreated = true;
          }
        }

        if (categoryId && categoryId !== "new") {
          await assignDocumentCategory(documentId, categoryId);
        }
      }
    } catch (err) {
      console.error(`[job-queue] Category suggestion failed for job ${jobId}:`, err);
    }
    await updateJobProgress(jobId, 90);

    // Step 4: Index in EdgeQuake for RAG search (90% → 100%)
    let edgeQuakeAvailable = false;
    try {
      if (doc.content) {
        await indexDocument({
          content: doc.content,
          title: doc.title ?? undefined,
          document_id: documentId,
          metadata: { language, user_id: userId },
          async_processing: false,
        });
        // Mark document as indexed in PostgreSQL
        await pool.query(
          `UPDATE documents SET indexed_at = NOW() WHERE id = $1`,
          [documentId],
        );
        edgeQuakeAvailable = true;
      }
    } catch (err) {
      console.error(`[job-queue] EdgeQuake indexing failed for job ${jobId}:`, err);
      // Flag for later sync — document is saved but needs EdgeQuake indexing
      try {
        await pool.query(
          `UPDATE documents SET metadata = metadata || '{"edgequake_sync_failed": true}'::jsonb WHERE id = $1`,
          [documentId],
        );
      } catch { /* best-effort flag */ }
    }

    // Step 5: Find and link related documents (90% → 95%)
    // Only attempt if EdgeQuake is reachable (Step 4 succeeded)
    if (edgeQuakeAvailable) {
      try {
        const searchText = [doc.title, structuredMeta.summary].filter(Boolean).join(" ");
        if (searchText.trim()) {
          const similar = await queryEdgeQuake({
            query: searchText,
            mode: "naive",
            max_results: 6,
            include_references: true,
          });

          const relatedDocs = similar.sources
            .filter((s) => s.document_id && s.document_id !== documentId && s.score > 0.7)
            .slice(0, 5);

          for (const rel of relatedDocs) {
            await pool.query(
              `INSERT INTO document_relations (document_id, related_document_id, score, relation_type)
               VALUES ($1, $2, $3, 'similar')
               ON CONFLICT (document_id, related_document_id) DO UPDATE SET score = $3`,
              [documentId, rel.document_id, rel.score],
            );
          }

          if (relatedDocs.length > 0) {
            await createNotification(userId, "related_found", doc.title ?? "Document", `${relatedDocs.length} related documents found`, { documentId, relatedCount: relatedDocs.length }).catch(() => {});
          }
        }
      } catch (err) {
        console.error(`[job-queue] Related document linking failed for job ${jobId}:`, err);
      }
    }
    await updateJobProgress(jobId, 95);

    // Notify: processing complete
    await createNotification(userId, "job_complete", doc.title ?? "Document", structuredMeta.summary || undefined, { documentId }).catch(() => {});

    // Done — notify connected SSE clients
    emitDocumentEvent({ type: "ingest:completed", documentId, userId, jobId, title: doc.title ?? undefined });
    await completeJob(jobId);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[job-queue] Job ${jobId} failed:`, err);

    // Retry logic
    if (job.retry_count < job.max_retries) {
      const delay = Math.pow(2, job.retry_count) * 1000; // Exponential backoff
      await pool.query(
        `UPDATE ingestion_jobs
         SET retry_count = retry_count + 1, status = 'pending', error_message = $1, updated_at = NOW()
         WHERE id = $2`,
        [errorMessage, jobId],
      );

      // Schedule retry
      setTimeout(() => {
        processJobById(jobId).catch((retryErr) => {
          console.error(`[job-queue] Retry failed for job ${jobId}:`, retryErr);
        });
      }, delay);
    } else {
      await failJob(jobId, errorMessage);
      emitDocumentEvent({ type: "ingest:failed", documentId, userId, jobId, error: errorMessage });
      await createNotification(userId, "job_failed", "Document processing failed", errorMessage, { documentId }).catch(() => {});
    }
  }
}
