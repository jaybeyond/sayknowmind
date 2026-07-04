import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/org-context";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";
import { readableClause, orgScopeClause } from "@/lib/visibility";

type GraphNodeResponse = {
  id: string;
  label: string;
  type: string;
  x: number;
  y: number;
  size: number;
  color: string;
};

type GraphEdgeResponse = { source: string; target: string; type: string; label: string };
type DocumentRow = { id: string; title: string };

const allowedTypes = new Set(["document", "entity", "category", "tag"]);
const contextualFilters = new Set(["entity", "category", "tag"]);

function addNode(nodes: GraphNodeResponse[], seen: Set<string>, node: GraphNodeResponse) {
  if (seen.has(node.id)) return;
  seen.add(node.id);
  nodes.push(node);
}

function addDocuments(documents: Map<string, DocumentRow>, rows: DocumentRow[]) {
  for (const row of rows) {
    if (!documents.has(row.id)) documents.set(row.id, row);
  }
}

export async function GET(request: NextRequest) {
  let userId: string | null = null;
  let organizationId: string | null = null;
  try {
    const ctx = await getOrgContext();
    if (ctx) {
      userId = ctx.userId;
      organizationId = ctx.organizationId;
    }
  } catch { /* auth check failed */ }

  if (!userId || !organizationId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const rawSearch = request.nextUrl.searchParams.get("search")?.trim();
  const search = rawSearch && rawSearch.length > 0 ? rawSearch : undefined;
  const searchPattern = search ? `%${search}%` : undefined;
  const requestedType = request.nextUrl.searchParams.get("type") ?? undefined;
  const typeFilter = requestedType && allowedTypes.has(requestedType) ? requestedType : undefined;

  // How many documents to pull into the graph. The old hard cap of 100 meant an
  // account with (say) 1700 memories only ever saw its 100 most-recent docs — the
  // rest of the "brain" was invisible. Default is generous enough to expose a
  // full library; `?limit=` overrides it, clamped so a pathological account can't
  // ask for an unbounded render. (Integer + clamp => safe to interpolate below.)
  const limitParam = Number(request.nextUrl.searchParams.get("limit"));
  const docLimit = Math.min(
    Math.max(Number.isFinite(limitParam) ? Math.trunc(limitParam) : 2000, 1),
    5000,
  );

  try {
    // Always build from PostgreSQL for full document+entity+category+tag graph.
    // EdgeQuake graph only has entities, so it cannot render the complete graph.
    const nodes: GraphNodeResponse[] = [];
    const nodeIds = new Set<string>();
    const edges: GraphEdgeResponse[] = [];
    const documents = new Map<string, DocumentRow>();

    // params[0]=userId ($1), params[1]=organizationId ($2) — fixed positions
    const docParams: unknown[] = [userId, organizationId];
    // d.updated_at has to appear in the projection because we sort by it
    // and Postgres rejects DISTINCT + ORDER BY on a column not in the
    // SELECT list (error 42P10). addDocuments() only keeps id+title so
    // the extra column is harmless.
    let docQuery = `SELECT DISTINCT d.id, d.title, d.updated_at
       FROM documents d
       WHERE ${readableClause("d", 2, 1, "document")}`;

    if (searchPattern) {
      docParams.push(searchPattern);
      docQuery += `
         AND (
           d.title ILIKE $3
           OR d.content ILIKE $3
           OR EXISTS (
             SELECT 1 FROM entities e
             WHERE e.document_id = d.id AND e.name ILIKE $3
           )
           OR EXISTS (
             SELECT 1
             FROM document_categories dc
             JOIN categories c ON c.id = dc.category_id
             WHERE dc.document_id = d.id
               AND ${readableClause("c", 2, 1, "category")}
               AND c.name ILIKE $3
           )
         )`;
    }

    docQuery += ` ORDER BY d.updated_at DESC LIMIT ${docLimit}`;
    const docs = await pool.query(docQuery, docParams);
    addDocuments(documents, docs.rows);

    // Tag search is isolated so deployments without the tags migration can still
    // serve document/entity/category graph search.
    if (searchPattern) {
      try {
        const tagMatchedDocs = await pool.query(
          `SELECT DISTINCT d.id, d.title, d.updated_at
           FROM documents d
           JOIN document_tags dt ON dt.document_id = d.id
           JOIN tags t ON t.id = dt.tag_id
           WHERE ${readableClause("d", 3, 1, "document")}
             AND ${orgScopeClause("t", 3)}
             AND (t.name ILIKE $2 OR t.canonical_name ILIKE $2)
           ORDER BY d.updated_at DESC
           LIMIT ${docLimit}`,
          [userId, searchPattern, organizationId],
        );
        addDocuments(documents, tagMatchedDocs.rows);
      } catch (err) {
        console.warn("[knowledge/graph] Tag search unavailable:", err);
      }
    }

    const docRows = [...documents.values()].slice(0, docLimit);
    const docIds = docRows.map((d) => d.id);
    const includeDocumentContext = !typeFilter
      || typeFilter === "document"
      || typeFilter === "entity"
      || typeFilter === "category"
      || typeFilter === "tag";

    if (includeDocumentContext) {
      for (const doc of docRows) {
        addNode(nodes, nodeIds, {
          id: doc.id,
          label: doc.title,
          type: "document",
          x: 0,
          y: 0,
          size: 8,
          color: "#00E5FF",
        });
      }
    }

    // Fetch entities for selected documents. In entity-filter search, only show
    // matching entity names; otherwise keep the full document context.
    if (docIds.length > 0 && (!typeFilter || typeFilter === "entity")) {
      const entityParams: unknown[] = [docIds];
      let entityQuery = `SELECT id, document_id, name, type, confidence
         FROM entities
         WHERE document_id = ANY($1)`;
      if (typeFilter === "entity" && searchPattern) {
        entityParams.push(searchPattern);
        entityQuery += ` AND name ILIKE $2`;
      }

      const entities = await pool.query(entityQuery, entityParams);

      for (const entity of entities.rows) {
        const existing = nodes.find((n) => n.label === entity.name && n.type === "entity");
        const confidence = Number(entity.confidence ?? 0.5);
        addNode(nodes, nodeIds, {
          id: existing?.id ?? entity.id,
          label: entity.name,
          type: "entity",
          x: 0,
          y: 0,
          size: 4 + confidence * 6,
          color: "#FF2E63",
        });
        edges.push({
          source: entity.document_id,
          target: existing?.id ?? entity.id,
          type: "mentions",
          label: "mentions",
        });
      }
    }

    // Fetch categories. Search narrows categories by name for category-filter
    // mode, and by either name or matched document context in the all-types view.
    if (!typeFilter || typeFilter === "category") {
      // params[0]=userId ($1), params[1]=organizationId ($2) — fixed positions
      const catParams: unknown[] = [userId, organizationId];
      let catQuery = `SELECT DISTINCT c.id, c.name, c.parent_id
         FROM categories c`;

      if (searchPattern && !typeFilter && docIds.length > 0) {
        catQuery += ` LEFT JOIN document_categories dc ON dc.category_id = c.id`;
      }

      catQuery += ` WHERE ${readableClause("c", 2, 1, "category")}`;

      if (searchPattern) {
        catParams.push(searchPattern);
        if (!typeFilter && docIds.length > 0) {
          catParams.push(docIds);
          catQuery += ` AND (c.name ILIKE $3 OR dc.document_id = ANY($4))`;
        } else {
          catQuery += ` AND c.name ILIKE $3`;
        }
      }

      catQuery += ` ORDER BY c.name LIMIT 100`;
      const cats = await pool.query(catQuery, catParams);
      for (const cat of cats.rows) {
        addNode(nodes, nodeIds, {
          id: cat.id,
          label: cat.name,
          type: "category",
          x: 0,
          y: 0,
          size: 7,
          color: "#7C3AED",
        });
        if (cat.parent_id) {
          edges.push({ source: cat.parent_id, target: cat.id, type: "parent", label: "parent" });
        }
      }

      if (docIds.length > 0) {
        const docCats = await pool.query(
          `SELECT dc.document_id, dc.category_id
           FROM document_categories dc
           JOIN categories c ON c.id = dc.category_id
           WHERE dc.document_id = ANY($1) AND ${readableClause("c", 3, 2, "category")}`,
          [docIds, userId, organizationId],
        );
        for (const dc of docCats.rows) {
          edges.push({ source: dc.document_id, target: dc.category_id, type: "belongs_to", label: "belongs_to" });
        }
      }
    }

    // Fetch tags and document-tag edges. Tag-filter search narrows to matching
    // tag labels, while all-types search keeps tag context for matched docs.
    if (docIds.length > 0 && (!typeFilter || typeFilter === "tag")) {
      try {
        // params[0]=userId ($1), params[1]=docIds ($2), params[2]=organizationId ($3) — fixed
        const tagParams: unknown[] = [userId, docIds, organizationId];
        let tagWhere = `${orgScopeClause("t", 3)} AND dt.document_id = ANY($2)`;
        if (typeFilter === "tag" && searchPattern) {
          tagParams.push(searchPattern);
          tagWhere += ` AND (t.name ILIKE $4 OR t.canonical_name ILIKE $4)`;
        }

        const tags = await pool.query(
          `SELECT t.id, t.name, t.canonical_name, COUNT(DISTINCT dt.document_id)::int AS document_count
           FROM tags t
           JOIN document_tags dt ON dt.tag_id = t.id
           WHERE ${tagWhere}
           GROUP BY t.id, t.name, t.canonical_name
           ORDER BY document_count DESC, t.name
           LIMIT 100`,
          tagParams,
        );

        for (const tag of tags.rows) {
          addNode(nodes, nodeIds, {
            id: tag.id,
            label: tag.name,
            type: "tag",
            x: 0,
            y: 0,
            size: 5 + Math.min(Number(tag.document_count ?? 1), 6),
            color: "#22C55E",
          });
        }

        const docTags = await pool.query(
          `SELECT dt.document_id, dt.tag_id
           FROM document_tags dt
           JOIN tags t ON t.id = dt.tag_id
           WHERE ${tagWhere}`,
          tagParams,
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
    if (docIds.length > 0 && (!typeFilter || typeFilter === "document")) {
      try {
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
