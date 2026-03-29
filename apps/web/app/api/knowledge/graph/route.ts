import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";

export async function GET(request: NextRequest) {
  let userId: string | null = null;
  try {
    userId = await getUserIdFromRequest();
  } catch { /* auth check failed */ }

  // Dev fallback: if not authenticated, use first user
  if (!userId) {
    try {
      const fallback = await pool.query(`SELECT id FROM "user" LIMIT 1`);
      userId = fallback.rows[0]?.id ?? null;
    } catch { /* ignore */ }
  }

  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const search = request.nextUrl.searchParams.get("search") ?? undefined;
  const typeFilter = request.nextUrl.searchParams.get("type") ?? undefined;

  try {
    // Always build from PostgreSQL for full document+entity+category graph
    // EdgeQuake graph only has entities — incomplete for our needs
    const nodes: Array<{
      id: string;
      label: string;
      type: string;
      x: number;
      y: number;
      size: number;
      color: string;
    }> = [];
    const edges: Array<{ source: string; target: string; label: string }> = [];

    // Fetch documents
    let docQuery = `SELECT id, title FROM documents WHERE user_id = $1`;
    const docParams: unknown[] = [userId];
    if (search) {
      docQuery += ` AND (title ILIKE $2 OR content ILIKE $2)`;
      docParams.push(`%${search}%`);
    }
    docQuery += ` LIMIT 100`;
    const docs = await pool.query(docQuery, docParams);

    for (const doc of docs.rows) {
      if (!typeFilter || typeFilter === "document") {
        nodes.push({
          id: doc.id,
          label: doc.title,
          type: "document",
          x: 0, y: 0,
          size: 8,
          color: "#00E5FF",
        });
      }
    }

    // Fetch entities for those documents
    if (docs.rows.length > 0) {
      const docIds = docs.rows.map((d: { id: string }) => d.id);
      const entities = await pool.query(
        `SELECT id, document_id, name, type, confidence
         FROM entities WHERE document_id = ANY($1)`,
        [docIds],
      );

      for (const entity of entities.rows) {
        if (!typeFilter || typeFilter === "entity") {
          // Deduplicate entities by name
          const existing = nodes.find((n) => n.label === entity.name && n.type === "entity");
          if (!existing) {
            nodes.push({
              id: entity.id,
              label: entity.name,
              type: "entity",
              x: 0, y: 0,
              size: 4 + entity.confidence * 6,
              color: "#FF2E63",
            });
          }
          edges.push({
            source: entity.document_id,
            target: existing?.id ?? entity.id,
            label: "mentions",
          });
        }
      }
    }

    // Fetch categories
    if (!typeFilter || typeFilter === "category") {
      const cats = await pool.query(
        `SELECT id, name, parent_id FROM categories WHERE user_id = $1`,
        [userId],
      );
      for (const cat of cats.rows) {
        nodes.push({
          id: cat.id,
          label: cat.name,
          type: "category",
          x: 0, y: 0,
          size: 7,
          color: "#7C3AED",
        });
        if (cat.parent_id) {
          edges.push({ source: cat.parent_id, target: cat.id, label: "parent" });
        }
      }

      // Document-category edges
      if (docs.rows.length > 0) {
        const docCats = await pool.query(
          `SELECT document_id, category_id FROM document_categories
           WHERE document_id = ANY($1)`,
          [docs.rows.map((d: { id: string }) => d.id)],
        );
        for (const dc of docCats.rows) {
          edges.push({ source: dc.document_id, target: dc.category_id, label: "belongs_to" });
        }
      }
    }

    // Document-document similarity edges (from document_relations)
    if (docs.rows.length > 0) {
      try {
        const docIds = docs.rows.map((d: { id: string }) => d.id);
        const relations = await pool.query(
          `SELECT document_id, related_document_id, score, relation_type
           FROM document_relations
           WHERE document_id = ANY($1) AND related_document_id = ANY($1)
           AND score > 0.5`,
          [docIds],
        );
        for (const rel of relations.rows) {
          edges.push({
            source: rel.document_id,
            target: rel.related_document_id,
            label: rel.relation_type ?? "similar",
          });
        }
      } catch { /* document_relations may not exist yet */ }
    }

    return NextResponse.json({ nodes, edges });
  } catch (err) {
    console.error("[knowledge/graph] Error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
