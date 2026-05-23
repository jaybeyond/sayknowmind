import type { QueryResult, QueryResultRow } from "pg";
import { pool } from "@/lib/db";

export interface TagRow extends QueryResultRow {
  id: string;
  user_id: string;
  name: string;
  canonical_name: string;
  created_at: Date;
}

export type Queryable = {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>>;
};

/**
 * Normalize a tag: lowercase, trim, collapse whitespace
 */
export function canonicalize(tag: string): string {
  return tag.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Get all tags for an organization
 */
export async function listTags(organizationId: string, db: Queryable = pool): Promise<TagRow[]> {
  const result = await db.query<TagRow>(
    `SELECT * FROM tags WHERE organization_id = $1 ORDER BY name`,
    [organizationId],
  );
  return result.rows;
}

/**
 * Get all tag names for an organization (for AI prompt)
 */
export async function listTagNames(organizationId: string, db: Queryable = pool): Promise<string[]> {
  const result = await db.query<{ name: string }>(
    `SELECT DISTINCT name FROM tags WHERE organization_id = $1 ORDER BY name`,
    [organizationId],
  );
  return result.rows.map((r) => r.name);
}

/**
 * Resolve a tag name: find existing or create new.
 * 3-step matching: exact canonical → fuzzy (contains/contained) → create new.
 */
export async function resolveTag(userId: string, organizationId: string, tagName: string, db: Queryable = pool): Promise<string> {
  const canonical = canonicalize(tagName);
  if (!canonical) throw new Error("Empty tag name");

  // Step 1: Exact canonical match
  const exact = await db.query<{ id: string }>(
    `SELECT id FROM tags WHERE organization_id = $1 AND canonical_name = $2`,
    [organizationId, canonical],
  );
  if (exact.rows.length > 0) {
    return exact.rows[0].id;
  }

  // Step 2: Fuzzy match — find tags that contain or are contained by this tag
  // e.g. "reactjs" matches "react", "ai agent" matches "ai"
  const fuzzy = await db.query<{ id: string; canonical_name: string }>(
    `SELECT id, canonical_name FROM tags WHERE organization_id = $1
     AND (canonical_name LIKE '%' || $2 || '%' OR $2 LIKE '%' || canonical_name || '%')
     ORDER BY length(canonical_name) DESC
     LIMIT 1`,
    [organizationId, canonical],
  );
  if (fuzzy.rows.length > 0) {
    return fuzzy.rows[0].id;
  }

  // Step 3: No match — create new
  const result = await db.query<{ id: string }>(
    `INSERT INTO tags (user_id, organization_id, name, canonical_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, canonical_name) DO UPDATE SET name = tags.name
     RETURNING id`,
    [userId, organizationId, tagName.trim(), canonical],
  );

  return result.rows[0].id;
}

/**
 * Resolve multiple tags and link them to a document.
 * Handles deduplication automatically.
 */
export async function assignTags(
  userId: string,
  organizationId: string,
  documentId: string,
  tagNames: string[],
  db: Queryable = pool,
): Promise<void> {
  for (const name of tagNames) {
    const canonical = canonicalize(name);
    if (!canonical) continue;

    const tagId = await resolveTag(userId, organizationId, name, db);

    await db.query(
      `INSERT INTO document_tags (document_id, tag_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [documentId, tagId],
    );
  }
}

/**
 * Get tags for a document
 */
export async function getDocumentTags(documentId: string, db: Queryable = pool): Promise<TagRow[]> {
  const result = await db.query<TagRow>(
    `SELECT t.* FROM tags t
     JOIN document_tags dt ON dt.tag_id = t.id
     WHERE dt.document_id = $1
     ORDER BY t.name`,
    [documentId],
  );
  return result.rows;
}

/**
 * Remove all tags from a document
 */
export async function clearDocumentTags(documentId: string, db: Queryable = pool): Promise<void> {
  await db.query(`DELETE FROM document_tags WHERE document_id = $1`, [documentId]);
}

/**
 * Delete a tag (and all document links)
 */
export async function deleteTag(tagId: string, organizationId: string, db: Queryable = pool): Promise<void> {
  await db.query(`DELETE FROM tags WHERE id = $1 AND organization_id = $2`, [tagId, organizationId]);
}

/**
 * Rename a tag (updates canonical_name too)
 */
export async function renameTag(tagId: string, organizationId: string, newName: string, db: Queryable = pool): Promise<void> {
  const canonical = canonicalize(newName);
  await db.query(
    `UPDATE tags SET name = $1, canonical_name = $2 WHERE id = $3 AND organization_id = $4`,
    [newName.trim(), canonical, tagId, organizationId],
  );
}

/**
 * Merge tags: move all document links from source to target, then delete source
 */
export async function mergeTags(sourceId: string, targetId: string, organizationId: string, db: Queryable = pool): Promise<void> {
  await db.query(
    `INSERT INTO document_tags (document_id, tag_id)
     SELECT document_id, $1 FROM document_tags WHERE tag_id = $2
     ON CONFLICT DO NOTHING`,
    [targetId, sourceId],
  );
  await db.query(`DELETE FROM document_tags WHERE tag_id = $1`, [sourceId]);
  await db.query(`DELETE FROM tags WHERE id = $1 AND organization_id = $2`, [sourceId, organizationId]);
}
