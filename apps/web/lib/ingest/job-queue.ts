import { pool } from "@/lib/db";
import type { IngestStatus, IngestStatusResponse } from "@/lib/types";
import { getDocument, updateDocument, insertEntities } from "./document-store";
import { generateSummary, extractEntities, suggestCategories } from "./ai-processor";
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

    // Step 1: Generate summary (20% → 40%)
    let summary = "";
    try {
      summary = await generateSummary(doc.content, language);
      await updateDocument(documentId, { summary });
    } catch (err) {
      console.error(`[job-queue] Summary generation failed for job ${jobId}:`, err);
      // Non-fatal: continue without summary
    }
    await updateJobProgress(jobId, 40);

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

      // Store suggestions in document metadata
      if (suggestions.length > 0) {
        await updateDocument(documentId, {
          metadata: { suggestedCategories: suggestions, language },
        });
      }
    } catch (err) {
      console.error(`[job-queue] Category suggestion failed for job ${jobId}:`, err);
    }
    await updateJobProgress(jobId, 90);

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
