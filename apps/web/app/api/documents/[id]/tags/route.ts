import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";
import { assignTags, canonicalize, getDocumentTags } from "@/lib/tags/store";

type RouteContext = { params: Promise<{ id: string }> };

async function ensureOwnedDocument(documentId: string, userId: string) {
  const result = await pool.query(
    `SELECT id FROM documents WHERE id = $1 AND user_id = $2`,
    [documentId, userId],
  );
  return result.rows.length > 0;
}

/** GET /api/documents/[id]/tags — list tags on this doc */
export async function GET(_request: NextRequest, context: RouteContext) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }
  const { id } = await context.params;

  // Allow reading tags on any visible (own + shared) document, since
  // shared docs already expose their categories the same way.
  const docCheck = await pool.query(
    `SELECT id FROM documents WHERE id = $1
       AND (user_id = $2 OR privacy_level = 'shared')`,
    [id, userId],
  );
  if (docCheck.rows.length === 0) {
    return NextResponse.json(
      { code: ErrorCode.SEARCH_NO_RESULTS, message: "Document not found", timestamp: new Date().toISOString() },
      { status: 404 },
    );
  }

  const tags = await getDocumentTags(id);
  return NextResponse.json({
    tags: tags.map((t) => ({ id: t.id, name: t.name, canonical_name: t.canonical_name })),
  });
}

/** POST /api/documents/[id]/tags — add tags to a doc (accumulative) */
export async function POST(request: NextRequest, context: RouteContext) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }
  const { id } = await context.params;

  if (!(await ensureOwnedDocument(id, userId))) {
    return NextResponse.json(
      { code: ErrorCode.SEARCH_NO_RESULTS, message: "Document not found", timestamp: new Date().toISOString() },
      { status: 404 },
    );
  }

  let body: { tags?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "Invalid JSON body", timestamp: new Date().toISOString() },
      { status: 400 },
    );
  }

  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    : [];
  if (tags.length === 0) {
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "tags must be a non-empty string array", timestamp: new Date().toISOString() },
      { status: 400 },
    );
  }

  try {
    await assignTags(userId, id, tags);
    const after = await getDocumentTags(id);
    return NextResponse.json({
      tags: after.map((t) => ({ id: t.id, name: t.name, canonical_name: t.canonical_name })),
    });
  } catch (err) {
    console.error("[document-tags] POST error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}

/** DELETE /api/documents/[id]/tags — remove specific tags or all */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }
  const { id } = await context.params;

  if (!(await ensureOwnedDocument(id, userId))) {
    return NextResponse.json(
      { code: ErrorCode.SEARCH_NO_RESULTS, message: "Document not found", timestamp: new Date().toISOString() },
      { status: 404 },
    );
  }

  let body: { tags?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is valid → "clear all"
  }

  const requested = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === "string" && t.trim().length > 0).map(canonicalize)
    : null;

  try {
    if (requested === null || requested.length === 0) {
      await pool.query(`DELETE FROM document_tags WHERE document_id = $1`, [id]);
    } else {
      await pool.query(
        `DELETE FROM document_tags WHERE document_id = $1
           AND tag_id IN (SELECT id FROM tags WHERE user_id = $2 AND canonical_name = ANY($3::text[]))`,
        [id, userId, requested],
      );
    }
    const after = await getDocumentTags(id);
    return NextResponse.json({
      tags: after.map((t) => ({ id: t.id, name: t.name, canonical_name: t.canonical_name })),
    });
  } catch (err) {
    console.error("[document-tags] DELETE error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
