import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/documents/:id */
export async function GET(_request: NextRequest, context: RouteContext) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const { id } = await context.params;

  try {
    const result = await pool.query(
      `SELECT d.id, d.title, d.content, d.summary, d.url, d.source_type,
              d.metadata, d.privacy_level, d.created_at, d.updated_at, d.indexed_at,
              COALESCE(
                (SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'color', c.color))
                 FROM document_categories dc
                 JOIN categories c ON c.id = dc.category_id
                 WHERE dc.document_id = d.id), '[]'
              ) AS categories
       FROM documents d
       WHERE d.id = $1 AND d.user_id = $2`,
      [id, userId],
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
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const { id } = await context.params;

  try {
    const body = await request.json();
    const { title, summary, metadata, privacyLevel } = body as {
      title?: string;
      summary?: string;
      metadata?: Record<string, unknown>;
      privacyLevel?: string;
    };

    // Build SET clauses dynamically
    const setClauses: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [];
    let paramIdx = 1;

    if (title !== undefined) {
      setClauses.push(`title = $${paramIdx}`);
      params.push(title);
      paramIdx++;
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

    if (setClauses.length === 1) {
      return NextResponse.json(
        { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "No fields to update", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    params.push(id, userId);

    const result = await pool.query(
      `UPDATE documents SET ${setClauses.join(", ")}
       WHERE id = $${paramIdx} AND user_id = $${paramIdx + 1}
       RETURNING id, title, summary, metadata, privacy_level, updated_at`,
      params,
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { code: ErrorCode.SEARCH_NO_RESULTS, message: "Document not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }

    return NextResponse.json(result.rows[0]);
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
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const { id } = await context.params;

  try {
    const result = await pool.query(
      `DELETE FROM documents WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId],
    );

    if (result.rows.length === 0) {
      return NextResponse.json(
        { code: ErrorCode.SEARCH_NO_RESULTS, message: "Document not found", timestamp: new Date().toISOString() },
        { status: 404 },
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
