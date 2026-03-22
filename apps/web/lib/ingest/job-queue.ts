import { pool } from "@/lib/db";
import type { IngestStatus, IngestStatusResponse } from "@/lib/types";
import { getDocument, updateDocument, insertEntities, assignDocumentCategory } from "./document-store";
import { generateSummary, extractEntities, suggestCategories, generateStructuredMetadata, type StructuredMetadata } from "./ai-processor";
import { indexDocument } from "@/lib/edgequake/client";
import { detectLanguage } from "./language-detect";

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

    // Detect language
    const language = detectLanguage(doc.content);
    await updateJobProgress(jobId, 20);

    // Step 1: Generate structured metadata via AI (20% → 50%)
    let structuredMeta: StructuredMetadata = {
      summary: "", what_it_solves: "", key_points: [], tags: [], reading_time_minutes: 1,
    };
    try {
      const wordCount = doc.content ? doc.content.split(/\s+/).length : 0;
      structuredMeta = await generateStructuredMetadata(doc.content ?? "", language, wordCount);

      await updateDocument(documentId, {
        summary: structuredMeta.summary || undefined,
        metadata: {
          summary: structuredMeta.summary,
          what_it_solves: structuredMeta.what_it_solves,
          key_points: structuredMeta.key_points,
          tags: structuredMeta.tags,
          reading_time_minutes: structuredMeta.reading_time_minutes,
          language,
        },
      });
    } catch (err) {
      console.error(`[job-queue] Structured metadata generation failed for job ${jobId}:`, err);
    }
    await updateJobProgress(jobId, 50);

    // Step 2: Extract entities (40% → 70%)
    try {
      const entities = await extractEntities(doc.content, language);
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

      const suggestions = await suggestCategories(doc.content, userId, existingCategories);

      // Auto-assign categories based on AI suggestions
      for (const suggestion of suggestions) {
        if (suggestion.confidence < 0.5) continue;

        let categoryId = suggestion.categoryId;

        // Create new category if AI suggests one that doesn't exist
        if (categoryId === "new" && suggestion.categoryName) {
          const insertResult = await pool.query(
            `INSERT INTO categories (user_id, name) VALUES ($1, $2)
             ON CONFLICT (user_id, name, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'))
             DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [userId, suggestion.categoryName],
          );
          categoryId = insertResult.rows[0]?.id;
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
    try {
      if (doc.content) {
        await indexDocument({
          content: doc.content,
          title: doc.title ?? undefined,
          document_id: documentId,
          metadata: { language, user_id: userId },
        });
        // Mark document as indexed in PostgreSQL
        await pool.query(
          `UPDATE documents SET indexed_at = NOW() WHERE id = $1`,
          [documentId],
        );
      }
    } catch (err) {
      console.error(`[job-queue] EdgeQuake indexing failed for job ${jobId}:`, err);
      // Non-fatal: RAG won't work but document is still saved
    }

    // Done
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
    }
  }
}
