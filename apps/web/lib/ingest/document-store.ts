import { pool } from "@/lib/db";
import type { SourceType, EntityType } from "@/lib/types";
import { recordSyncEvent } from "@/lib/relay/sync-service";
import { resolveDefaultPrivacy } from "@/lib/org-context";

export interface InsertDocumentParams {
  userId: string;
  organizationId: string;
  title: string;
  content: string;
  summary?: string;
  url?: string;
  sourceType: SourceType;
  metadata: Record<string, unknown>;
  /** Override the default visibility. When omitted, documents created in a
   *  team org default to 'shared' (team-wide) and personal-org docs to 'private'. */
  privacyLevel?: "private" | "shared";
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
  const privacyLevel =
    params.privacyLevel ?? (await resolveDefaultPrivacy(params.organizationId, params.userId));
  const result = await pool.query(
    `INSERT INTO documents (user_id, organization_id, title, content, summary, url, source_type, metadata, privacy_level)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      params.userId,
      params.organizationId,
      params.title,
      params.content,
      params.summary ?? null,
      params.url ?? null,
      params.sourceType,
      JSON.stringify(params.metadata),
      privacyLevel,
    ],
  );
  const documentId = result.rows[0].id;

  // Relay sync hook — non-blocking, best-effort
  recordSyncEvent(pool, params.userId, documentId, "create").catch(() => {});

  return documentId;
}

export async function updateDocument(
  documentId: string,
  updates: { title?: string; content?: string; summary?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.title !== undefined) {
    setClauses.push(`title = $${idx++}`);
    values.push(updates.title);
  }
  if (updates.content !== undefined) {
    setClauses.push(`content = $${idx++}`);
    values.push(updates.content);
  }
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

  const ids: string[] = [];

  for (const entity of entities) {
    // Per-org de-dup at the application layer (migration 063 intentionally adds NO
    // unique index — older DBs already hold duplicate (org, name) rows). Look for an
    // existing entity in THIS document's organization and update it; otherwise insert.
    // When the document has no organization we never match an existing row, so org-less
    // entities are inserted fresh and can't re-introduce the cross-user collision.
    const found = await pool.query(
      `SELECT e.id FROM entities e, documents d
        WHERE d.id = $1 AND e.name = $2
          AND d.organization_id IS NOT NULL
          AND e.organization_id = d.organization_id
        LIMIT 1`,
      [entity.documentId, entity.name],
    );

    let id: string | undefined;
    if (found.rows[0]) {
      const upd = await pool.query(
        `UPDATE entities SET
           document_id = COALESCE(document_id, $2),
           confidence = GREATEST(confidence, $3),
           metadata = metadata || $4::jsonb
         WHERE id = $1
         RETURNING id`,
        [found.rows[0].id, entity.documentId, entity.confidence, JSON.stringify(entity.properties ?? {})],
      );
      id = upd.rows[0]?.id;
    } else {
      const ins = await pool.query(
        `INSERT INTO entities (document_id, organization_id, name, entity_type, type, confidence, metadata)
         VALUES ($1, (SELECT organization_id FROM documents WHERE id = $1), $2, $3, $4::varchar(50), $5, $6)
         RETURNING id`,
        [
          entity.documentId,
          entity.name,
          entity.type,
          entity.type,
          entity.confidence,
          JSON.stringify(entity.properties ?? {}),
        ],
      );
      id = ins.rows[0]?.id;
    }
    if (id) ids.push(id);
  }

  return ids;
}

// ── Duplicate Detection ───────────────────────────────────────

export async function findDuplicateByUrl(
  userId: string,
  url: string,
  organizationId?: string,
): Promise<{ id: string; title: string } | null> {
  const result = await pool.query(
    `SELECT id, title FROM documents
     WHERE user_id = $1 AND url = $2
       AND ($3::text IS NULL OR organization_id = $3)
       AND (metadata->>'status' IS NULL OR metadata->>'status' = 'active')
     LIMIT 1`,
    [userId, url, organizationId ?? null],
  );
  return result.rows[0] ?? null;
}

export async function findDuplicateByFileName(
  userId: string,
  fileName: string,
  organizationId?: string,
): Promise<{ id: string; title: string } | null> {
  const result = await pool.query(
    `SELECT id, title FROM documents
     WHERE user_id = $1 AND metadata->>'fileName' = $2
       AND ($3::text IS NULL OR organization_id = $3)
       AND (metadata->>'status' IS NULL OR metadata->>'status' = 'active')
     LIMIT 1`,
    [userId, fileName, organizationId ?? null],
  );
  return result.rows[0] ?? null;
}

/** Append " (2)" / " (3)" etc. to a name, preserving file extension. */
export function deduplicateName(name: string): string {
  // Match: base + optional " (N)" + optional .ext
  const m = name.match(/^(.+?)(\s*\((\d+)\))?(\.[^.]+)?$/);
  if (m) {
    const base = m[1];
    const num = m[3] ? parseInt(m[3]) + 1 : 2;
    const ext = m[4] ?? "";
    return `${base} (${num})${ext}`;
  }
  return `${name} (2)`;
}

export async function assignDocumentCategory(
  documentId: string,
  categoryId: string,
): Promise<void> {
  // Ownership guard (IDOR): only link the category if it belongs to the same
  // owner as the document — the document's own user, or a category shared inside
  // the document's organization. A category that belongs to someone else is
  // silently ignored rather than linked. Owner is derived from the rows, so no
  // caller needs to pass (and be trusted for) userId/orgId.
  await pool.query(
    `INSERT INTO document_categories (document_id, category_id)
     SELECT d.id, c.id
       FROM documents d, categories c
      WHERE d.id = $1 AND c.id = $2
        AND (c.user_id = d.user_id
             OR (c.organization_id IS NOT NULL
                 AND c.organization_id = d.organization_id))
     ON CONFLICT DO NOTHING`,
    [documentId, categoryId],
  );
}
