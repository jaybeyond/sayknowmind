import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";
import { visibilityClause } from "@/lib/visibility";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ nodeId: string }> },
) {
  let userId: string | null = null;
  try {
    userId = await getUserIdFromRequest();
  } catch { /* auth failed */ }

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
      `SELECT d.id, d.title, d.url, d.source_type, d.metadata, d.created_at
       FROM documents d
       WHERE d.id = $1 AND ${visibilityClause("d", 2)}`,
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
       WHERE e.id = $1 AND ${visibilityClause("d", 2)}`,
      [nodeId, userId],
    );

    if (entityResult.rows.length > 0) {
      const entity = entityResult.rows[0];
      // Get all documents mentioning this entity name
      const docsWithEntity = await pool.query(
        `SELECT DISTINCT d.id, d.title, d.url
         FROM documents d
         JOIN entities e ON e.document_id = d.id
         WHERE e.name = $1 AND ${visibilityClause("d", 2)}`,
        [entity.name, userId],
      );

      return NextResponse.json({
        id: entity.id,
        label: entity.name,
        type: "entity",
        properties: {
          entityType: entity.type,
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
      `SELECT c.id, c.name, c.description, c.depth, c.path
       FROM categories c
       WHERE c.id = $1 AND ${visibilityClause("c", 2)}`,
      [nodeId, userId],
    );

    if (catResult.rows.length > 0) {
      const cat = catResult.rows[0];
      const catDocs = await pool.query(
        `SELECT d.id, d.title, d.url
         FROM documents d
         JOIN document_categories dc ON dc.document_id = d.id
         WHERE dc.category_id = $1 AND ${visibilityClause("d", 2)}`,
        [nodeId, userId],
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

    // Try as tag
    try {
      const tagResult = await pool.query(
        `SELECT t.id, t.name, t.canonical_name, t.created_at
         FROM tags t
         WHERE t.id = $1 AND t.user_id = $2`,
        [nodeId, userId],
      );

      if (tagResult.rows.length > 0) {
        const tag = tagResult.rows[0];
        const tagDocs = await pool.query(
          `SELECT DISTINCT d.id, d.title, d.url
           FROM documents d
           JOIN document_tags dt ON dt.document_id = d.id
           WHERE dt.tag_id = $1 AND ${visibilityClause("d", 2)}
           ORDER BY d.title`,
          [nodeId, userId],
        );

        return NextResponse.json({
          id: tag.id,
          label: tag.name,
          type: "tag",
          properties: {
            canonicalName: tag.canonical_name,
            documentCount: tagDocs.rows.length,
            createdAt: tag.created_at,
          },
          connectedDocuments: tagDocs.rows.map((d: { id: string; title: string; url: string | null }) => ({
            id: d.id,
            title: d.title,
            url: d.url ?? undefined,
          })),
        });
      }
    } catch (err) {
      console.warn("[knowledge/node] Tags unavailable:", err);
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
