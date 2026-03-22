import { pool } from "@/lib/db";

export interface CategoryRow {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  color: string | null;
  depth: number;
  path: string;
  privacy_level: string;
  created_at: Date;
  updated_at: Date;
}

export async function listCategories(userId: string): Promise<CategoryRow[]> {
  const result = await pool.query(
    `SELECT * FROM categories WHERE user_id = $1 ORDER BY path, name`,
    [userId],
  );
  return result.rows;
}

export async function getCategory(id: string, userId: string): Promise<CategoryRow | null> {
  const result = await pool.query(
    `SELECT * FROM categories WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return result.rows[0] ?? null;
}

export async function createCategory(params: {
  userId: string;
  name: string;
  parentId?: string;
  description?: string;
  color?: string;
  privacyLevel?: string;
}): Promise<CategoryRow> {
  let depth = 0;
  let path = params.name;
  let privacyLevel = params.privacyLevel ?? "private";

  // If parent specified, compute depth, path, and inherit privacy
  if (params.parentId) {
    const parent = await getCategory(params.parentId, params.userId);
    if (!parent) {
      throw new Error("Parent category not found");
    }
    depth = parent.depth + 1;
    path = `${parent.path}/${params.name}`;
    // Inherit privacy from parent if not explicitly set
    if (!params.privacyLevel) {
      privacyLevel = parent.privacy_level;
    }
  }

  // Check for duplicate name under same parent
  const existing = await pool.query(
    `SELECT * FROM categories WHERE user_id = $1 AND name = $2 AND COALESCE(parent_id, '00000000-0000-0000-0000-000000000000') = $3`,
    [params.userId, params.name, params.parentId ?? "00000000-0000-0000-0000-000000000000"],
  );
  if (existing.rows.length > 0) {
    return existing.rows[0]; // Return existing instead of creating duplicate
  }

  const result = await pool.query(
    `INSERT INTO categories (user_id, parent_id, name, description, color, depth, path, privacy_level)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      params.userId,
      params.parentId ?? null,
      params.name,
      params.description ?? null,
      params.color ?? null,
      depth,
      path,
      privacyLevel,
    ],
  );
  return result.rows[0];
}

export async function updateCategory(
  id: string,
  userId: string,
  updates: {
    name?: string;
    parentId?: string;
    description?: string;
    color?: string;
    privacyLevel?: string;
  },
): Promise<CategoryRow | null> {
  const current = await getCategory(id, userId);
  if (!current) return null;

  const name = updates.name ?? current.name;
  let depth = current.depth;
  let path = current.path;
  const parentId = updates.parentId !== undefined ? updates.parentId : current.parent_id;

  // Recalculate depth and path if parent or name changed
  if (updates.parentId !== undefined || updates.name) {
    if (parentId) {
      // Check for circular reference
      if (parentId === id) {
        throw Object.assign(new Error("Circular reference"), { code: 4003 });
      }
      const parent = await getCategory(parentId, userId);
      if (!parent) throw new Error("Parent category not found");
      if (parent.path.startsWith(current.path + "/")) {
        throw Object.assign(new Error("Circular reference"), { code: 4003 });
      }
      depth = parent.depth + 1;
      path = `${parent.path}/${name}`;
    } else {
      depth = 0;
      path = name;
    }
  }

  // Wrap both UPDATE statements in a transaction for atomicity
  const client = await pool.connect();
  let result;
  try {
    await client.query("BEGIN");

    result = await client.query(
      `UPDATE categories
       SET name = $1, parent_id = $2, description = $3, color = $4,
           depth = $5, path = $6, privacy_level = COALESCE($9, privacy_level),
           updated_at = NOW()
       WHERE id = $7 AND user_id = $8
       RETURNING *`,
      [
        name,
        parentId ?? null,
        updates.description !== undefined ? updates.description : current.description,
        updates.color !== undefined ? updates.color : current.color,
        depth,
        path,
        id,
        userId,
        updates.privacyLevel ?? null,
      ],
    );

    // Update paths of all children atomically
    if (current.path !== path) {
      await client.query(
        `UPDATE categories
         SET path = $1 || substring(path from $2),
             depth = depth + ($3 - $4),
             updated_at = NOW()
         WHERE user_id = $5 AND path LIKE $6 AND id != $7`,
        [path, current.path.length + 1, depth, current.depth, userId, `${current.path}/%`, id],
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return result.rows[0] ?? null;
}

export async function deleteCategory(
  id: string,
  userId: string,
): Promise<{ success: boolean; movedDocuments: number }> {
  // Move documents to uncategorized (remove category assignment)
  const docResult = await pool.query(
    `DELETE FROM document_categories WHERE category_id = $1
     RETURNING document_id`,
    [id],
  );

  // Move children to parent
  const cat = await getCategory(id, userId);
  if (cat) {
    await pool.query(
      `UPDATE categories SET parent_id = $1,
         depth = GREATEST(0, depth - 1),
         updated_at = NOW()
       WHERE parent_id = $2 AND user_id = $3`,
      [cat.parent_id, id, userId],
    );
  }

  await pool.query(
    `DELETE FROM categories WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );

  return {
    success: true,
    movedDocuments: docResult.rowCount ?? 0,
  };
}

export async function mergeCategories(
  sourceIds: string[],
  targetId: string,
  userId: string,
): Promise<{ success: boolean; mergedCount: number }> {
  // Verify target exists
  const target = await getCategory(targetId, userId);
  if (!target) throw new Error("Target category not found");

  let mergedCount = 0;

  for (const sourceId of sourceIds) {
    if (sourceId === targetId) continue;

    // Move document assignments from source to target
    await pool.query(
      `INSERT INTO document_categories (document_id, category_id)
       SELECT document_id, $1 FROM document_categories WHERE category_id = $2
       ON CONFLICT DO NOTHING`,
      [targetId, sourceId],
    );

    // Move children to target
    await pool.query(
      `UPDATE categories SET parent_id = $1, updated_at = NOW()
       WHERE parent_id = $2 AND user_id = $3`,
      [targetId, sourceId, userId],
    );

    // Delete source category
    await pool.query(
      `DELETE FROM document_categories WHERE category_id = $1`,
      [sourceId],
    );
    await pool.query(
      `DELETE FROM categories WHERE id = $1 AND user_id = $2`,
      [sourceId, userId],
    );

    mergedCount++;
  }

  return { success: true, mergedCount };
}
