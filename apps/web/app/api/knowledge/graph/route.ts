import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";
import { visibilityClause } from "@/lib/visibility";

export async function GET(request: NextRequest) {
  let userId: string | null = null;
  try {
    userId = await getUserIdFromRequest();
  } catch { /* auth check failed */ }

  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const search = request.nextUrl.searchParams.get("search") ?? undefined;
  const requestedType = request.nextUrl.searchParams.get("type") ?? undefined;
  const allowedTypes = new Set(["document", "entity", "category", "tag"]);
  const typeFilter = requestedType && allowedTypes.has(requestedType) ? requestedType : undefined;

  try {
    // Always build from PostgreSQL for full document+entity+category+tag graph
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
    const edges: Array<{ source: string; target: string; type: string; label: string }> = [];

    // Fetch documents
    let docQuery = `SELECT d.id, d.title FROM documents d WHERE ${visibilityClause("d", 1)}`;
    const docParams: unknown[] = [userId];
    if (search) {
      docQuery += ` AND (d.title ILIKE $2 OR d.content ILIKE $2)`;
      docParams.push(`%${search}%`);
    }
    docQuery += ` LIMIT 100`;
    const docs = await pool.query(docQuery, docParams);
    const includeDocumentContext = !typeFilter || typeFilter === "document" || typeFilter === "entity" || typeFilter === "category" || typeFilter === "tag";

    for (const doc of docs.rows) {
      if (includeDocumentContext) {
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
    if (docs.rows.length > 0 && (!typeFilter || typeFilter === "entity")) {
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
            type: "mentions",
            label: "mentions",
          });
        }
      }
    }

    // Fetch categories
    if (!typeFilter || typeFilter === "category") {
      const cats = await pool.query(
        `SELECT c.id, c.name, c.parent_id
         FROM categories c
         WHERE ${visibilityClause("c", 1)}`,
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
          edges.push({ source: cat.parent_id, target: cat.id, type: "parent", label: "parent" });
        }
      }

      // Document-category edges
      if (docs.rows.length > 0) {
        const docCats = await pool.query(
          `SELECT dc.document_id, dc.category_id
           FROM document_categories dc
           JOIN categories c ON c.id = dc.category_id
           WHERE dc.document_id = ANY($1) AND ${visibilityClause("c", 2)}`,
          [docs.rows.map((d: { id: string }) => d.id), userId],
        );
        for (const dc of docCats.rows) {
          edges.push({ source: dc.document_id, target: dc.category_id, type: "belongs_to", label: "belongs_to" });
        }
      }
    }

    // Fetch tags and document-tag edges
    if (docs.rows.length > 0 && (!typeFilter || typeFilter === "tag")) {
      try {
        const docIds = docs.rows.map((d: { id: string }) => d.id);
        const tags = await pool.query(
          `SELECT t.id, t.name, t.canonical_name, COUNT(DISTINCT dt.document_id)::int AS document_count
           FROM tags t
           JOIN document_tags dt ON dt.tag_id = t.id
           WHERE t.user_id = $1 AND dt.document_id = ANY($2)
           GROUP BY t.id, t.name, t.canonical_name
           ORDER BY document_count DESC, t.name
           LIMIT 100`,
          [userId, docIds],
        );

        for (const tag of tags.rows) {
          nodes.push({
            id: tag.id,
            label: tag.name,
            type: "tag",
            x: 0, y: 0,
            size: 5 + Math.min(Number(tag.document_count ?? 1), 6),
            color: "#22C55E",
          });
        }

        const docTags = await pool.query(
          `SELECT dt.document_id, dt.tag_id
           FROM document_tags dt
           JOIN tags t ON t.id = dt.tag_id
           WHERE t.user_id = $1 AND dt.document_id = ANY($2)`,
          [userId, docIds],
        );

        for (const dt of docTags.rows) {
          edges.push({
            source: dt.document_id,
            target: dt.tag_id,
            type: "tagged_with",
            label: "tagged_with",
          });
        }
      } catch (err) {
        // Tags are introduced by a later migration; keep graph usable if it has
        // not been applied yet.
        console.warn("[knowledge/graph] Tags unavailable:", err);
      }
    }

    // Document-document similarity edges (from document_relations)
    if (docs.rows.length > 0 && (!typeFilter || typeFilter === "document")) {
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
            type: rel.relation_type ?? "similar",
            label: rel.relation_type ?? "similar",
          });
        }
      } catch { /* document_relations may not exist yet */ }
    }

    const contextualFilters = new Set(["entity", "category", "tag"]);
    const responseNodes = typeFilter && contextualFilters.has(typeFilter)
      ? nodes.filter((node) => {
          if (node.type !== "document") return true;
          return edges.some((edge) => edge.source === node.id || edge.target === node.id);
        })
      : nodes;
    const responseNodeIds = new Set(responseNodes.map((node) => node.id));
    const responseEdges = edges.filter((edge) => responseNodeIds.has(edge.source) && responseNodeIds.has(edge.target));

    return NextResponse.json({ nodes: responseNodes, edges: responseEdges });
  } catch (err) {
    console.error("[knowledge/graph] Error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
