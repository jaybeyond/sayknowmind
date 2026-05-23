import { pool } from "@/lib/db";
import { readableClause, writableClause, editableViaShareClause } from "@/lib/visibility";
import { isOrgAdmin, OrgContext } from "@/lib/org-context";

export interface CategoryRow {
  id: string;
  user_id: string;
  organization_id: string;
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

export async function listCategories(
  ctx: OrgContext,
  options: { includeShared?: boolean } = {},
): Promise<CategoryRow[]> {
  // $1 = userId, $2 = organizationId
  const scope =
    options.includeShared === false
      ? `(c.organization_id = $2 AND c.user_id = $1)`
      : readableClause("c", 2, 1, "category");
  const result = await pool.query(
    `SELECT c.* FROM categories c WHERE ${scope} ORDER BY c.path, c.name`,
    [ctx.userId, ctx.organizationId],
  );
  return result.rows;
}

export async function getCategory(id: string, ctx: OrgContext): Promise<CategoryRow | null> {
  // $1 = id, $2 = userId, $3 = organizationId
  const result = await pool.query(
    `SELECT c.* FROM categories c WHERE c.id = $1 AND ${readableClause("c", 3, 2, "category")}`,
    [id, ctx.userId, ctx.organizationId],
  );
  return result.rows[0] ?? null;
}

async function getOwnedCategory(id: string, ctx: OrgContext): Promise<CategoryRow | null> {
  // $1 = id, $2 = userId, $3 = organizationId
  const admin = isOrgAdmin(ctx.role);
  const result = await pool.query(
    `SELECT * FROM categories WHERE id = $1 AND ${writableClause("categories", 3, 2, admin)}`,
    [id, ctx.userId, ctx.organizationId],
  );
  return result.rows[0] ?? null;
}

export async function createCategory(params: {
  ctx: OrgContext;
  name: string;
  parentId?: string;
  description?: string;
  color?: string;
  privacyLevel?: string;
}): Promise<CategoryRow> {
  const { ctx } = params;
  let depth = 0;
  let path = params.name;
  let privacyLevel = params.privacyLevel ?? "private";

  // If parent specified, compute depth, path, and inherit privacy
  if (params.parentId) {
    const parent = await getOwnedCategory(params.parentId, ctx);
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

  // Check for duplicate name under same parent (org-scoped)
  const existing = await pool.query(
    `SELECT * FROM categories
     WHERE organization_id = $1 AND user_id = $2 AND name = $3
       AND COALESCE(parent_id, '00000000-0000-0000-0000-000000000000') = $4`,
    [
      ctx.organizationId,
      ctx.userId,
      params.name,
      params.parentId ?? "00000000-0000-0000-0000-000000000000",
    ],
  );
  if (existing.rows.length > 0) {
    return existing.rows[0]; // Return existing instead of creating duplicate
  }

  const result = await pool.query(
    `INSERT INTO categories (user_id, organization_id, parent_id, name, description, color, depth, path, privacy_level)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      ctx.userId,
      ctx.organizationId,
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
  ctx: OrgContext,
  updates: {
    name?: string;
    parentId?: string;
    description?: string;
    color?: string;
    privacyLevel?: string;
  },
): Promise<CategoryRow | null> {
  const current = await getOwnedCategory(id, ctx);
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
      const parent = await getOwnedCategory(parentId, ctx);
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

  const admin = isOrgAdmin(ctx.role);

  // Wrap both UPDATE statements in a transaction for atomicity
  const client = await pool.connect();
  let result;
  try {
    await client.query("BEGIN");

    // $1=name $2=parentId $3=description $4=color $5=depth $6=path $7=privacyLevel
    // $8=id $9=userId $10=organizationId
    result = await client.query(
      `UPDATE categories
       SET name = $1, parent_id = $2, description = $3, color = $4,
           depth = $5, path = $6, privacy_level = COALESCE($7, privacy_level),
           updated_at = NOW()
       WHERE id = $8 AND (${writableClause("categories", 10, 9, admin)} OR ${editableViaShareClause("categories", 9, "category")})
       RETURNING *`,
      [
        name,
        parentId ?? null,
        updates.description !== undefined ? updates.description : current.description,
        updates.color !== undefined ? updates.color : current.color,
        depth,
        path,
        updates.privacyLevel ?? null,
        id,
        ctx.userId,
        ctx.organizationId,
      ],
    );

    // Update paths of all children atomically (org-scoped, admin-aware)
    if (current.path !== path) {
      // $1=newPath $2=oldPathLen+1 $3=newDepth $4=oldDepth $5=userId $6=organizationId $7=pathPattern $8=id
      if (admin) {
        await client.query(
          `UPDATE categories
           SET path = $1 || substring(path from $2),
               depth = depth + ($3 - $4),
               updated_at = NOW()
           WHERE organization_id = $5 AND path LIKE $6 AND id != $7`,
          [path, current.path.length + 1, depth, current.depth, ctx.organizationId, `${current.path}/%`, id],
        );
      } else {
        await client.query(
          `UPDATE categories
           SET path = $1 || substring(path from $2),
               depth = depth + ($3 - $4),
               updated_at = NOW()
           WHERE organization_id = $5 AND user_id = $6 AND path LIKE $7 AND id != $8`,
          [path, current.path.length + 1, depth, current.depth, ctx.organizationId, ctx.userId, `${current.path}/%`, id],
        );
      }
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
  ctx: OrgContext,
): Promise<{ success: boolean; movedDocuments: number }> {
  const cat = await getOwnedCategory(id, ctx);
  if (!cat) {
    return { success: false, movedDocuments: 0 };
  }

  const admin = isOrgAdmin(ctx.role);

  // Move documents to uncategorized (remove category assignment)
  const docResult = await pool.query(
    `DELETE FROM document_categories WHERE category_id = $1
     RETURNING document_id`,
    [id],
  );

  // Move children to parent (org-scoped, admin-aware)
  if (admin) {
    await pool.query(
      `UPDATE categories SET parent_id = $1,
         depth = GREATEST(0, depth - 1),
         updated_at = NOW()
       WHERE parent_id = $2 AND organization_id = $3`,
      [cat.parent_id, id, ctx.organizationId],
    );
  } else {
    await pool.query(
      `UPDATE categories SET parent_id = $1,
         depth = GREATEST(0, depth - 1),
         updated_at = NOW()
       WHERE parent_id = $2 AND organization_id = $3 AND user_id = $4`,
      [cat.parent_id, id, ctx.organizationId, ctx.userId],
    );
  }

  // Delete the category itself (writable check already done via getOwnedCategory)
  await pool.query(
    `DELETE FROM categories WHERE id = $1 AND (${writableClause("categories", 3, 2, admin)} OR ${editableViaShareClause("categories", 2, "category")})`,
    [id, ctx.userId, ctx.organizationId],
  );

  return {
    success: true,
    movedDocuments: docResult.rowCount ?? 0,
  };
}

export async function mergeCategories(
  sourceIds: string[],
  targetId: string,
  ctx: OrgContext,
): Promise<{ success: boolean; mergedCount: number }> {
  const admin = isOrgAdmin(ctx.role);

  // Verify target is writable by the caller
  const target = await getOwnedCategory(targetId, ctx);
  if (!target) throw new Error("Target category not found");

  let mergedCount = 0;

  for (const sourceId of sourceIds) {
    if (sourceId === targetId) continue;

    const source = await getOwnedCategory(sourceId, ctx);
    if (!source) continue;

    // Move document assignments from source to target
    await pool.query(
      `INSERT INTO document_categories (document_id, category_id)
       SELECT document_id, $1 FROM document_categories WHERE category_id = $2
       ON CONFLICT DO NOTHING`,
      [targetId, sourceId],
    );

    // Move children to target (org-scoped, admin-aware)
    if (admin) {
      await pool.query(
        `UPDATE categories SET parent_id = $1, updated_at = NOW()
         WHERE parent_id = $2 AND organization_id = $3`,
        [targetId, sourceId, ctx.organizationId],
      );
    } else {
      await pool.query(
        `UPDATE categories SET parent_id = $1, updated_at = NOW()
         WHERE parent_id = $2 AND organization_id = $3 AND user_id = $4`,
        [targetId, sourceId, ctx.organizationId, ctx.userId],
      );
    }

    // Delete source category document assignments
    await pool.query(
      `DELETE FROM document_categories WHERE category_id = $1`,
      [sourceId],
    );
    // Delete source category (writable already confirmed above)
    await pool.query(
      `DELETE FROM categories WHERE id = $1 AND ${writableClause("categories", 3, 2, admin)}`,
      [sourceId, ctx.userId, ctx.organizationId],
    );

    mergedCount++;
  }

  return { success: true, mergedCount };
}
