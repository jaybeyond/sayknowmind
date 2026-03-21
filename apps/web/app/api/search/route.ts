import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { checkAntiBot } from "@/lib/antibot";
import { queryEdgeQuake } from "@/lib/edgequake/client";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";
import type { QueryMode, SearchResponse, SearchResult, Citation } from "@/lib/types";

// Map our QueryMode to EdgeQuake modes
const MODE_MAP: Record<QueryMode, string> = {
  local: "local",
  global: "global",
  hybrid: "hybrid",
  drift: "hybrid", // drift maps to hybrid in EdgeQuake
  mix: "mix",
  naive: "naive",
};

export async function POST(request: NextRequest) {
  // Auth check
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  // Rate limiting
  const blocked = checkAntiBot(request, userId);
  if (blocked) return blocked;

  try {
    const body = await request.json();
    const {
      query,
      mode = "hybrid",
      limit = 10,
      offset = 0,
      filters,
    } = body as {
      query?: string;
      mode?: QueryMode;
      limit?: number;
      offset?: number;
      filters?: { categoryIds?: string[]; dateRange?: { start: string; end: string }; tags?: string[] };
    };

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return NextResponse.json(
        { code: ErrorCode.SEARCH_INVALID_QUERY, message: "Query is required", timestamp: new Date().toISOString() },
        { status: 400 },
      );
    }

    const startTime = Date.now();

    // Query EdgeQuake for RAG search
    let eqResponse;
    try {
      eqResponse = await queryEdgeQuake({
        query: query.trim(),
        mode: (MODE_MAP[mode] ?? "hybrid") as "naive" | "local" | "global" | "hybrid" | "mix",
        include_references: true,
        max_results: limit,
      });
    } catch {
      // Fallback: direct PostgreSQL full-text search if EdgeQuake is unavailable
      return await fallbackSearch(query, userId, limit, offset, filters, startTime);
    }

    // Build search results with citations from EdgeQuake sources
    const results: SearchResult[] = [];
    const documentIds = new Set<string>();

    for (const source of eqResponse.sources) {
      if (source.document_id) {
        documentIds.add(source.document_id);
      }
    }

    // Fetch document details for citations
    if (documentIds.size > 0) {
      const docResult = await pool.query(
        `SELECT id, title, url, content, summary FROM documents
         WHERE id = ANY($1) AND user_id = $2`,
        [Array.from(documentIds), userId],
      );

      const docMap = new Map<string, { id: string; title: string; url: string | null; content: string; summary: string | null }>();
      for (const row of docResult.rows) {
        docMap.set(row.id, row);
      }

      // Build results grouped by document
      for (const source of eqResponse.sources) {
        const doc = source.document_id ? docMap.get(source.document_id) : undefined;
        if (!doc) continue;

        // Check if we already have a result for this document
        let existing = results.find((r) => r.documentId === doc.id);
        if (!existing) {
          existing = {
            documentId: doc.id,
            title: doc.title,
            snippet: doc.summary || doc.content.slice(0, 200),
            score: source.score,
            citations: [],
            entities: [],
          };
          results.push(existing);
        }

        // Add citation
        const citation: Citation = {
          documentId: doc.id,
          title: doc.title,
          url: doc.url ?? undefined,
          excerpt: source.snippet || doc.content.slice(0, 150),
          relevanceScore: source.score,
        };
        existing.citations.push(citation);
      }
    }

    // If EdgeQuake returned an answer but no document sources, return the answer as context
    if (results.length === 0 && eqResponse.answer) {
      results.push({
        documentId: "",
        title: "AI Answer",
        snippet: eqResponse.answer,
        score: 1.0,
        citations: [],
        entities: [],
      });
    }

    // Apply offset
    const paginatedResults = results.slice(offset, offset + limit);
    const took = Date.now() - startTime;

    const response: SearchResponse = {
      results: paginatedResults,
      totalCount: results.length,
      took,
    };

    return NextResponse.json(response);
  } catch (err) {
    console.error("[search] Error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}

/** PostgreSQL fallback search when EdgeQuake is unavailable */
async function fallbackSearch(
  query: string,
  userId: string,
  limit: number,
  offset: number,
  filters: { categoryIds?: string[]; dateRange?: { start: string; end: string }; tags?: string[] } | undefined,
  startTime: number,
): Promise<NextResponse> {
  const conditions: string[] = ["d.user_id = $1"];
  const params: unknown[] = [userId];
  let idx = 2;

  // Full-text search using ILIKE (basic fallback)
  conditions.push(`(d.title ILIKE $${idx} OR d.content ILIKE $${idx})`);
  params.push(`%${query}%`);
  idx++;

  // Category filter
  if (filters?.categoryIds?.length) {
    conditions.push(`d.id IN (SELECT document_id FROM document_categories WHERE category_id = ANY($${idx}))`);
    params.push(filters.categoryIds);
    idx++;
  }

  // Date range filter
  if (filters?.dateRange?.start) {
    conditions.push(`d.created_at >= $${idx}`);
    params.push(filters.dateRange.start);
    idx++;
  }
  if (filters?.dateRange?.end) {
    conditions.push(`d.created_at <= $${idx}`);
    params.push(filters.dateRange.end);
    idx++;
  }

  const result = await pool.query(
    `SELECT d.id, d.title, d.url, d.summary, d.content
     FROM documents d
     WHERE ${conditions.join(" AND ")}
     ORDER BY d.updated_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset],
  );

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM documents d WHERE ${conditions.join(" AND ")}`,
    params,
  );

  const results: SearchResult[] = result.rows.map((row: { id: string; title: string; url: string | null; summary: string | null; content: string }) => ({
    documentId: row.id,
    title: row.title,
    snippet: row.summary || row.content.slice(0, 200),
    score: 1.0,
    citations: [{
      documentId: row.id,
      title: row.title,
      url: row.url ?? undefined,
      excerpt: row.summary || row.content.slice(0, 150),
      relevanceScore: 1.0,
    }],
    entities: [],
  }));

  const response: SearchResponse = {
    results,
    totalCount: parseInt(countResult.rows[0].count),
    took: Date.now() - startTime,
  };

  return NextResponse.json(response);
}
