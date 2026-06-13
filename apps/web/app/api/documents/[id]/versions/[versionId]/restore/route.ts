import { NextRequest, NextResponse } from "next/server";
import { getOrgContext, isOrgAdmin } from "@/lib/org-context";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";
import { writableClause, editableViaShareClause } from "@/lib/visibility";
import { emitDocumentEvent } from "@/lib/events";
import { captureDocumentVersion } from "@/lib/versions/store";

type RouteContext = { params: Promise<{ id: string; versionId: string }> };

/**
 * POST /api/documents/:id/versions/:versionId/restore
 *
 * Roll the live document back to a saved checkpoint. The current state is
 * snapshotted first (so a restore is itself undoable), then the document row is
 * overwritten and the collab CRDT is reset — on reconnect the client re-seeds
 * the editors from the restored content.
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const { id, versionId } = await context.params;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Must have write access to the document.
    const writable = await client.query(
      `SELECT id FROM documents
        WHERE id = $1 AND (${writableClause("documents", 3, 2, isOrgAdmin(ctx.role))} OR ${editableViaShareClause("documents", 2, "document")})`,
      [id, ctx.userId, ctx.organizationId],
    );
    if (writable.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { code: ErrorCode.SEARCH_NO_RESULTS, message: "Document not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }

    // Load the target checkpoint (must belong to this document).
    const version = await client.query(
      `SELECT title, content, metadata FROM document_versions WHERE id = $1 AND document_id = $2`,
      [versionId, id],
    );
    if (version.rows.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { code: ErrorCode.SEARCH_NO_RESULTS, message: "Version not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }
    const snap = version.rows[0];

    // 1. Snapshot the present state so the restore can be undone.
    await captureDocumentVersion(id, ctx.userId, { force: true, db: client });
    // 2. Overwrite the live document with the chosen checkpoint.
    await client.query(
      `UPDATE documents SET title = $2, content = $3, metadata = $4, updated_at = NOW() WHERE id = $1`,
      [id, snap.title ?? null, snap.content ?? null, snap.metadata ?? null],
    );
    // 3. Reset the collaborative CRDT so editors re-seed from the restored row.
    await client.query(`DELETE FROM doc_collab WHERE document_id = $1`, [id]);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[documents] restore error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  } finally {
    client.release();
  }

  emitDocumentEvent({ type: "document:updated", documentId: id, userId: ctx.userId });
  return NextResponse.json({ restored: true, id, versionId });
}
