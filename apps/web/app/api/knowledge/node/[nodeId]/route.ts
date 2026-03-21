import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ nodeId: string }> },
) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const { nodeId } = await params;

  try {
    // Try as document
    const docResult = await pool.query(
      `SELECT id, title, url, source_type, metadata, created_at FROM documents
       WHERE id = $1 AND user_id = $2`,
      [nodeId, userId],
    );

    if (docResult.rows.length > 0) {
      const doc = docResult.rows[0];
      // Get connected entities
      const entities = await pool.query(
        `SELECT id, name, type, confidence FROM entities WHERE document_id = $1`,
        [nodeId],
      );
      return NextResponse.json({
        id: doc.id,
        label: doc.title,
        type: "document",
        properties: {
          sourceType: doc.source_type,
          url: doc.url,
          createdAt: doc.created_at,
          ...doc.metadata,
        },
        connectedDocuments: [],
        connectedEntities: entities.rows,
      });
    }

    // Try as entity
    const entityResult = await pool.query(
      `SELECT e.id, e.name, e.type, e.confidence, e.properties, e.document_id
       FROM entities e
       JOIN documents d ON d.id = e.document_id
       WHERE e.id = $1 AND d.user_id = $2`,
      [nodeId, userId],
    );

    if (entityResult.rows.length > 0) {
      const entity = entityResult.rows[0];
      // Get all documents mentioning this entity name
      const docsWithEntity = await pool.query(
        `SELECT DISTINCT d.id, d.title, d.url
         FROM documents d
         JOIN entities e ON e.document_id = d.id
         WHERE e.name = $1 AND d.user_id = $2`,
        [entity.name, userId],
      );

      return NextResponse.json({
        id: entity.id,
        label: entity.name,
        type: entity.type,
        properties: {
          confidence: entity.confidence,
          ...entity.properties,
        },
        connectedDocuments: docsWithEntity.rows.map((d: { id: string; title: string; url: string | null }) => ({
          id: d.id,
          title: d.title,
          url: d.url ?? undefined,
        })),
      });
    }

    // Try as category
    const catResult = await pool.query(
      `SELECT id, name, description, depth, path FROM categories
       WHERE id = $1 AND user_id = $2`,
      [nodeId, userId],
    );

    if (catResult.rows.length > 0) {
      const cat = catResult.rows[0];
      const catDocs = await pool.query(
        `SELECT d.id, d.title, d.url
         FROM documents d
         JOIN document_categories dc ON dc.document_id = d.id
         WHERE dc.category_id = $1`,
        [nodeId],
      );

      return NextResponse.json({
        id: cat.id,
        label: cat.name,
        type: "category",
        properties: {
          description: cat.description,
          depth: cat.depth,
          path: cat.path,
        },
        connectedDocuments: catDocs.rows.map((d: { id: string; title: string; url: string | null }) => ({
          id: d.id,
          title: d.title,
          url: d.url ?? undefined,
        })),
      });
    }

    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Node not found", timestamp: new Date().toISOString() },
      { status: 404 },
    );
  } catch (err) {
    console.error("[knowledge/node] Error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
