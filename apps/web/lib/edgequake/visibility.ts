import { pool } from "@/lib/db";
import { readableClause } from "@/lib/visibility";

/**
 * EdgeQuake is a SINGLE SHARED index — it does not enforce per-user/org isolation
 * (it ignores X-User-ID for scoping; everything lives in one shared workspace).
 * Therefore EVERY consumer that surfaces EdgeQuake results to a user MUST re-filter
 * them through PostgreSQL visibility first. `searchKnowledge()` already does this
 * inline; these helpers are the shared gate so other call sites (ultrarag pipeline,
 * related-docs, future ones) can't forget to.
 */

/** Of the given document ids, return the set this user/org may actually read. */
export async function filterVisibleDocIds(
  docIds: Array<string | undefined | null>,
  userId: string | null | undefined,
  organizationId: string | null | undefined,
): Promise<Set<string>> {
  if (!userId) return new Set();
  const ids = [...new Set(docIds.filter((d): d is string => Boolean(d)))];
  if (ids.length === 0) return new Set();
  const res = await pool.query(
    `SELECT d.id FROM documents d
      WHERE d.id = ANY($1) AND ${readableClause("d", 3, 2, "document")}`,
    [ids, userId, organizationId ?? null],
  );
  return new Set((res.rows as Array<{ id: string }>).map((r) => r.id));
}

/** Filter an EdgeQuake sources array down to documents readable by this user/org. */
export async function filterVisibleSources<
  T extends { document_id?: string | null; id?: string | null },
>(
  sources: T[],
  userId: string | null | undefined,
  organizationId: string | null | undefined,
): Promise<T[]> {
  const visible = await filterVisibleDocIds(
    sources.map((s) => s.document_id ?? s.id),
    userId,
    organizationId,
  );
  return sources.filter((s) => {
    const id = s.document_id ?? s.id;
    return id != null && visible.has(id);
  });
}
