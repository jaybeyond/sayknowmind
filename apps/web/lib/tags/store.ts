import { pool } from "@/lib/db";

export interface TagRow {
  id: string;
  user_id: string;
  name: string;
  canonical_name: string;
  created_at: Date;
}

/**
 * Normalize a tag: lowercase, trim, collapse whitespace
 */
export function canonicalize(tag: string): string {
  return tag.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Get all tags for a user
 */
export async function listTags(userId: string): Promise<TagRow[]> {
  const result = await pool.query(
    `SELECT * FROM tags WHERE user_id = $1 ORDER BY name`,
    [userId],
  );
  return result.rows;
}

/**
 * Get all tag names for a user (for AI prompt)
 */
export async function listTagNames(userId: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT DISTINCT name FROM tags WHERE user_id = $1 ORDER BY name`,
    [userId],
  );
  return result.rows.map((r: { name: string }) => r.name);
}

/**
 * Resolve a tag name: find existing or create new.
 * Returns the tag ID. Deduplication via canonical_name.
 */
export async function resolveTag(userId: string, tagName: string): Promise<string> {
  const canonical = canonicalize(tagName);
  if (!canonical) throw new Error("Empty tag name");

  // Try to find existing
  const existing = await pool.query(
    `SELECT id FROM tags WHERE user_id = $1 AND canonical_name = $2`,
    [userId, canonical],
  );

  if (existing.rows.length > 0) {
    return existing.rows[0].id;
  }

  // Create new
  const result = await pool.query(
    `INSERT INTO tags (user_id, name, canonical_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, canonical_name) DO UPDATE SET name = tags.name
     RETURNING id`,
    [userId, tagName.trim(), canonical],
  );

  return result.rows[0].id;
}

/**
 * Resolve multiple tags and link them to a document.
 * Handles deduplication automatically.
 */
export async function assignTags(
  userId: string,
  documentId: string,
  tagNames: string[],
): Promise<void> {
  for (const name of tagNames) {
    const canonical = canonicalize(name);
    if (!canonical) continue;

    const tagId = await resolveTag(userId, name);

    await pool.query(
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
export async function getDocumentTags(documentId: string): Promise<TagRow[]> {
  const result = await pool.query(
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
export async function clearDocumentTags(documentId: string): Promise<void> {
  await pool.query(`DELETE FROM document_tags WHERE document_id = $1`, [documentId]);
}

/**
 * Delete a tag (and all document links)
 */
export async function deleteTag(tagId: string, userId: string): Promise<void> {
  await pool.query(`DELETE FROM tags WHERE id = $1 AND user_id = $2`, [tagId, userId]);
}

/**
 * Rename a tag (updates canonical_name too)
 */
export async function renameTag(tagId: string, userId: string, newName: string): Promise<void> {
  const canonical = canonicalize(newName);
  await pool.query(
    `UPDATE tags SET name = $1, canonical_name = $2 WHERE id = $3 AND user_id = $4`,
    [newName.trim(), canonical, tagId, userId],
  );
}

/**
 * Merge tags: move all document links from source to target, then delete source
 */
export async function mergeTags(sourceId: string, targetId: string, userId: string): Promise<void> {
  await pool.query(
    `INSERT INTO document_tags (document_id, tag_id)
     SELECT document_id, $1 FROM document_tags WHERE tag_id = $2
     ON CONFLICT DO NOTHING`,
    [targetId, sourceId],
  );
  await pool.query(`DELETE FROM document_tags WHERE tag_id = $1`, [sourceId]);
  await pool.query(`DELETE FROM tags WHERE id = $1 AND user_id = $2`, [sourceId, userId]);
}
