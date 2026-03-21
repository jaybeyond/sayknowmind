import { pool } from "@/lib/db";
import type { SourceType, EntityType } from "@/lib/types";

export interface InsertDocumentParams {
  userId: string;
  title: string;
  content: string;
  summary?: string;
  url?: string;
  sourceType: SourceType;
  metadata: Record<string, unknown>;
}

export interface InsertEntityParams {
  documentId: string;
  name: string;
  type: EntityType;
  confidence: number;
  properties?: Record<string, unknown>;
}

export interface DocumentRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  summary: string | null;
  url: string | null;
  source_type: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  indexed_at: Date | null;
}

export async function insertDocument(params: InsertDocumentParams): Promise<string> {
  const result = await pool.query(
    `INSERT INTO documents (user_id, title, content, summary, url, source_type, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      params.userId,
      params.title,
      params.content,
      params.summary ?? null,
      params.url ?? null,
      params.sourceType,
      JSON.stringify(params.metadata),
    ],
  );
  return result.rows[0].id;
}

export async function updateDocument(
  documentId: string,
  updates: { summary?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.summary !== undefined) {
    setClauses.push(`summary = $${idx++}`);
    values.push(updates.summary);
  }
  if (updates.metadata !== undefined) {
    setClauses.push(`metadata = metadata || $${idx++}::jsonb`);
    values.push(JSON.stringify(updates.metadata));
  }

  if (setClauses.length === 0) return;

  setClauses.push(`updated_at = NOW()`);
  values.push(documentId);

  await pool.query(
    `UPDATE documents SET ${setClauses.join(", ")} WHERE id = $${idx}`,
    values,
  );
}

export async function getDocument(documentId: string): Promise<DocumentRow | null> {
  const result = await pool.query(
    `SELECT * FROM documents WHERE id = $1`,
    [documentId],
  );
  return result.rows[0] ?? null;
}

export async function insertEntities(entities: InsertEntityParams[]): Promise<string[]> {
  if (entities.length === 0) return [];

  const values: unknown[] = [];
  const placeholders: string[] = [];
  let idx = 1;

  for (const entity of entities) {
    placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
    values.push(
      entity.documentId,
      entity.name,
      entity.type,
      entity.confidence,
      JSON.stringify(entity.properties ?? {}),
    );
  }

  const result = await pool.query(
    `INSERT INTO entities (document_id, name, type, confidence, properties)
     VALUES ${placeholders.join(", ")}
     RETURNING id`,
    values,
  );

  return result.rows.map((r: { id: string }) => r.id);
}

export async function assignDocumentCategory(
  documentId: string,
  categoryId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO document_categories (document_id, category_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [documentId, categoryId],
  );
}
