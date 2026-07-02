import { NextRequest, NextResponse } from "next/server";
import { getOrgContext, isOrgAdmin } from "@/lib/org-context";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";
import { readableClause, writableClause, editableViaShareClause } from "@/lib/visibility";
import { emitDocumentEvent } from "@/lib/events";
import { assignTags, clearDocumentTags, type Queryable } from "@/lib/tags/store";
import { captureDocumentVersion } from "@/lib/versions/store";
import { deindexDocumentIfUnreferenced as deleteEdgeQuakeDocument, reindexDocumentById } from "@/lib/edgequake/client";
import { ensureEqDocumentIdColumn } from "@/lib/ingest/document-store";

type RouteContext = { params: Promise<{ id: string }> };

function hasTagPatch(metadata: Record<string, unknown> | undefined): boolean {
  if (!metadata) return false;
  return ["aiTags", "userTags", "tags"].some((key) =>
    Object.prototype.hasOwnProperty.call(metadata, key),
  );
}

function extractTags(metadata: Record<string, unknown> | null | undefined): string[] {
  if (!metadata) return [];
  const tagValues = ["aiTags", "userTags", "tags"].flatMap((key) => {
    const value = metadata[key];
    return Array.isArray(value) ? value : [];
  });
  return [...new Set(tagValues.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0))];
}

async function syncDocumentTagsFromMetadata(
  userId: string,
  organizationId: string,
  documentId: string,
  metadata: Record<string, unknown> | null | undefined,
  db: Queryable = pool,
) {
  await clearDocumentTags(documentId, db);
  const tags = extractTags(metadata);
  if (tags.length > 0) {
    await assignTags(userId, organizationId, documentId, tags, db);
  }
}

/** GET /api/documents/:id */
export async function GET(_request: NextRequest, context: RouteContext) {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const { id } = await context.params;

  try {
    // params: $1 = id, $2 = ctx.userId, $3 = ctx.organizationId
    const result = await pool.query(
      `SELECT d.id, d.title, d.content, d.summary, d.url, d.source_type,
              d.metadata, d.privacy_level, d.created_at, d.updated_at, d.indexed_at,
              COALESCE(
                (SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'color', c.color))
                 FROM document_categories dc
                 JOIN categories c ON c.id = dc.category_id
                 WHERE dc.document_id = d.id AND ${readableClause("c", 3, 2, "category")}), '[]'
              ) AS categories
       FROM documents d
       WHERE d.id = $1 AND ${readableClause("d", 3, 2, "document")}`,
      [id, ctx.userId, ctx.organizationId],
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { code: ErrorCode.SEARCH_NO_RESULTS, message: "Document not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }

    return NextResponse.json(result.rows[0]);
  } catch (err) {
    console.error("[documents] GET/:id error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}

/** PATCH /api/documents/:id — update metadata (isFavorite, tags, etc.) */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const { id } = await context.params;

  try {
    const body = await request.json();
    const { title, summary, content, metadata, privacyLevel, categoryId } = body as {
      title?: string;
      summary?: string;
      content?: string;
      metadata?: Record<string, unknown>;
      privacyLevel?: string;
      categoryId?: string | null;
    };
    const metadataTouchesTags = hasTagPatch(metadata);

    // If content is changing, the EdgeQuake index becomes stale. Capture the old
    // eq_document_id now so we can de-index it after the row is updated (the
    // UPDATE nulls indexed_at + eq_document_id so the reprocessor re-indexes).
    let staleEqDocId: string | null = null;
    // Only reference the eq_document_id column in the UPDATE if we can confirm it
    // exists. ensureEqDocumentIdColumn() self-heals it on no-migration deploys,
    // but if that ALTER fails (restricted DDL / lock timeout) an unconditional
    // `eq_document_id = NULL` would throw 42703 and 500 every content autosave
    // (see CODE-REVIEW P18).
    let eqColumnReady = false;
    if (content !== undefined) {
      try {
        await ensureEqDocumentIdColumn();
        eqColumnReady = true;
        const prev = await pool.query(`SELECT eq_document_id FROM documents WHERE id = $1`, [id]);
        staleEqDocId = (prev.rows[0]?.eq_document_id as string | null) ?? null;
      } catch (prefetchErr) {
        console.warn("[documents] PATCH eq_document_id prefetch failed:", prefetchErr);
      }
    }

    // Build SET clauses dynamically
    const setClauses: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (title !== undefined) {
      setClauses.push(`title = $${paramIdx}`);
      params.push(title);
      paramIdx++;
    }

    if (content !== undefined) {
      setClauses.push(`content = $${paramIdx}`);
      params.push(content);
      paramIdx++;
      setClauses.push(`indexed_at = NULL`);
      if (eqColumnReady) setClauses.push(`eq_document_id = NULL`);
    }

    if (summary !== undefined) {
      setClauses.push(`summary = $${paramIdx}`);
      params.push(summary);
      paramIdx++;
    }

    if (metadata !== undefined) {
      setClauses.push(`metadata = metadata || $${paramIdx}::jsonb`);
      params.push(JSON.stringify(metadata));
      paramIdx++;
    }

    if (privacyLevel !== undefined) {
      if (privacyLevel !== "private" && privacyLevel !== "shared") {
        return NextResponse.json(
          { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "privacyLevel must be 'private' or 'shared'", timestamp: new Date().toISOString() },
          { status: 400 },
        );
      }
      setClauses.push(`privacy_level = $${paramIdx}`);
      params.push(privacyLevel);
      paramIdx++;
    }

    if (setClauses.length === 1 /* only updated_at */ && categoryId === undefined) {
      return NextResponse.json(
        { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "No fields to update", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    const client = await pool.connect();
    const rollbackAndReturn = async (response: NextResponse) => {
      await client.query("ROLLBACK").catch((rollbackErr: unknown) => {
        console.warn("[documents] PATCH rollback failed:", rollbackErr);
      });
      return response;
    };

    try {
      await client.query("BEGIN");

      // Handle category change inside the same transaction as the document
      // update so graph edges never observe half-applied category state.
      if (categoryId !== undefined) {
        // params: $1 = id, $2 = ctx.userId, $3 = ctx.organizationId
        const docCheck = await client.query(
          `SELECT id FROM documents WHERE id = $1 AND (${writableClause("documents", 3, 2, isOrgAdmin(ctx.role))} OR ${editableViaShareClause("documents", 2, "document")})`,
          [id, ctx.userId, ctx.organizationId],
        );
        if (docCheck.rows.length === 0) {
          return await rollbackAndReturn(NextResponse.json(
            { code: ErrorCode.SEARCH_NO_RESULTS, message: "Document not found", timestamp: new Date().toISOString() },
            { status: 404 },
          ));
        }

        if (categoryId) {
          // params: $1 = categoryId, $2 = ctx.userId, $3 = ctx.organizationId
          const categoryCheck = await client.query(
            `SELECT id FROM categories WHERE id = $1 AND (${writableClause("categories", 3, 2, isOrgAdmin(ctx.role))} OR ${editableViaShareClause("categories", 2, "category")})`,
            [categoryId, ctx.userId, ctx.organizationId],
          );
          if (categoryCheck.rows.length === 0) {
            return await rollbackAndReturn(NextResponse.json(
              { code: ErrorCode.CATEGORY_NOT_FOUND, message: "Category not found", timestamp: new Date().toISOString() },
              { status: 404 },
            ));
          }
        }

        await client.query(`DELETE FROM document_categories WHERE document_id = $1`, [id]);
        if (categoryId) {
          await client.query(
            `INSERT INTO document_categories (document_id, category_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [id, categoryId],
          );
        }
      }

      // If only categoryId was changed, no need to update documents table.
      if (setClauses.length === 1) {
        await client.query("COMMIT");
        emitDocumentEvent({ type: "document:updated", documentId: id, userId: ctx.userId });
        return NextResponse.json({ id, categoryUpdated: true });
      }

      // Append id, userId, organizationId as the last three params.
      // paramIdx currently points to the next available slot.
      // $paramIdx = id, $(paramIdx+1) = ctx.userId, $(paramIdx+2) = ctx.organizationId
      params.push(id, ctx.userId, ctx.organizationId);

      const result = await client.query(
        `UPDATE documents SET ${setClauses.join(", ")}
         WHERE id = $${paramIdx} AND (${writableClause("documents", paramIdx + 2, paramIdx + 1, isOrgAdmin(ctx.role))} OR ${editableViaShareClause("documents", paramIdx + 1, "document")})
         RETURNING id, title, summary, metadata, privacy_level, updated_at`,
        params,
      );

      if (result.rows.length === 0) {
        return await rollbackAndReturn(NextResponse.json(
          { code: ErrorCode.SEARCH_NO_RESULTS, message: "Document not found", timestamp: new Date().toISOString() },
          { status: 404 },
        ));
      }

      if (metadataTouchesTags) {
        await client.query("SAVEPOINT document_tags_sync");
        try {
          await syncDocumentTagsFromMetadata(ctx.userId, ctx.organizationId, id, result.rows[0].metadata ?? {}, client);
          await client.query("RELEASE SAVEPOINT document_tags_sync");
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT document_tags_sync");
          await client.query("RELEASE SAVEPOINT document_tags_sync");
          // Keep metadata updates usable if the tags migration has not been
          // applied yet; graph tags will appear after the normalized tables exist.
          console.warn("[documents] Failed to sync normalized document tags:", err);
        }
      }

      await client.query("COMMIT");
      emitDocumentEvent({ type: "document:updated", documentId: id, userId: ctx.userId, title: result.rows[0].title ?? undefined });

      // On a content edit: de-index the now-stale EdgeQuake doc, then re-index
      // the new content immediately in the background so the document stays in
      // RAG search/chat instead of disappearing until the periodic reprocessor
      // runs (see CODE-REVIEW C8). Both are best-effort and never block the save.
      if (content !== undefined) {
        if (staleEqDocId) {
          deleteEdgeQuakeDocument(staleEqDocId).catch((eqErr) =>
            console.warn("[documents] EdgeQuake de-index on edit failed:", eqErr),
          );
        }
        reindexDocumentById(id).catch((eqErr) =>
          console.warn("[documents] EdgeQuake re-index on edit failed:", eqErr),
        );
      }

      // Checkpoint editable content (notes/sheets/mindmaps) into version history.
      // Throttled + best-effort: a versioning hiccup must never fail the save.
      const isContentSave =
        content !== undefined ||
        (metadata !== undefined && (metadata.docTabs !== undefined || metadata.mindmap !== undefined));
      if (isContentSave) {
        try {
          await captureDocumentVersion(id, ctx.userId);
        } catch (versionErr) {
          console.warn("[documents] version capture failed:", versionErr);
        }
      }

      return NextResponse.json(result.rows[0]);
    } catch (err) {
      await client.query("ROLLBACK").catch((rollbackErr: unknown) => {
        console.warn("[documents] PATCH rollback failed:", rollbackErr);
      });
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("[documents] PATCH/:id error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}

/** DELETE /api/documents/:id — soft-delete via metadata or hard-delete */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const { id } = await context.params;

  try {
    await ensureEqDocumentIdColumn();
    // params: $1 = id, $2 = ctx.userId, $3 = ctx.organizationId
    const result = await pool.query(
      `DELETE FROM documents WHERE id = $1 AND (${writableClause("documents", 3, 2, isOrgAdmin(ctx.role))} OR ${editableViaShareClause("documents", 2, "document")}) RETURNING id, eq_document_id`,
      [id, ctx.userId, ctx.organizationId],
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { code: ErrorCode.SEARCH_NO_RESULTS, message: "Document not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }

    emitDocumentEvent({ type: "document:deleted", documentId: id, userId: ctx.userId });

    // Best-effort EdgeQuake de-index (shared corpus) — never block the delete.
    const eqDocId = result.rows[0]?.eq_document_id as string | null;
    if (eqDocId) {
      deleteEdgeQuakeDocument(eqDocId).catch((eqErr) =>
        console.warn("[documents] EdgeQuake de-index failed:", eqErr),
      );
    }

    return NextResponse.json({ deleted: true, id });
  } catch (err) {
    console.error("[documents] DELETE/:id error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
