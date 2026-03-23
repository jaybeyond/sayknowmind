/**
 * Lightweight EdgeQuake API client for the web app.
 * Calls the EdgeQuake Rust service (port 8080) directly via fetch.
 */

const EDGEQUAKE_URL = process.env.EDGEQUAKE_URL ?? "http://localhost:8080";
const EDGEQUAKE_API_KEY = process.env.EDGEQUAKE_API_KEY ?? "";
const EDGEQUAKE_TIMEOUT = 30_000;

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (EDGEQUAKE_API_KEY) h["Authorization"] = `Bearer ${EDGEQUAKE_API_KEY}`;
  return h;
}

// ── Query Types (subset of EdgeQuake API) ──────────────────────

export type QueryMode = "naive" | "local" | "global" | "hybrid" | "mix";

export interface EQQueryRequest {
  query: string;
  mode?: QueryMode;
  include_references?: boolean;
  max_results?: number;
  llm_provider?: string;
  llm_model?: string;
}

export interface EQSourceReference {
  source_type: string;
  id: string;
  score: number;
  snippet?: string;
  reference_id?: number;
  document_id?: string;
  file_path?: string;
}

export interface EQQueryResponse {
  answer: string;
  mode: string;
  sources: EQSourceReference[];
  stats: {
    embedding_time_ms: number;
    retrieval_time_ms: number;
    generation_time_ms: number;
    total_time_ms: number;
    sources_retrieved: number;
  };
}

// ── Graph Types ────────────────────────────────────────────────

export interface EQGraphNode {
  id: string;
  label: string;
  properties?: Record<string, unknown>;
}

export interface EQGraphEdge {
  source: string;
  target: string;
  label: string;
  weight?: number;
}

export interface EQGraphResponse {
  nodes: EQGraphNode[];
  edges: EQGraphEdge[];
}

// ── Client Functions ───────────────────────────────────────────

export async function queryEdgeQuake(request: EQQueryRequest): Promise<EQQueryResponse> {
  const response = await fetch(`${EDGEQUAKE_URL}/api/v1/query`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      ...request,
      include_references: request.include_references ?? true,
    }),
    signal: AbortSignal.timeout(EDGEQUAKE_TIMEOUT),
  });

  if (!response.ok) {
    throw new Error(`EdgeQuake query failed: ${response.status}`);
  }

  return response.json();
}

export async function getGraph(options?: {
  limit?: number;
  search?: string;
  labels?: string[];
}): Promise<EQGraphResponse> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.search) params.set("search", options.search);
  if (options?.labels?.length) params.set("labels", options.labels.join(","));
  const qs = params.toString();
  const path = qs ? `/api/v1/graph?${qs}` : "/api/v1/graph";

  const response = await fetch(`${EDGEQUAKE_URL}${path}`, {
    method: "GET",
    headers: headers(),
    signal: AbortSignal.timeout(EDGEQUAKE_TIMEOUT),
  });

  if (!response.ok) {
    throw new Error(`EdgeQuake graph failed: ${response.status}`);
  }

  return response.json();
}

export async function streamQuery(
  request: EQQueryRequest,
): Promise<ReadableStream<Uint8Array>> {
  const response = await fetch(`${EDGEQUAKE_URL}/api/v1/query/stream`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok || !response.body) {
    throw new Error(`EdgeQuake stream failed: ${response.status}`);
  }

  return response.body;
}

// ── Index Types ──────────────────────────────────────────────

export interface EQIndexRequest {
  content: string;
  title?: string;
  document_id?: string;
  metadata?: Record<string, unknown>;
  async_processing?: boolean;
}

export interface EQIndexResponse {
  document_id: string;
  status: string;
  task_id?: string;
  chunk_count?: number;
  entity_count?: number;
}

// ── Index Function ───────────────────────────────────────────

export async function indexDocument(request: EQIndexRequest): Promise<EQIndexResponse> {
  const response = await fetch(`${EDGEQUAKE_URL}/api/v1/documents`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      content: request.content,
      title: request.title,
      metadata: { ...request.metadata, sayknowmind_document_id: request.document_id },
      async_processing: request.async_processing ?? true,
    }),
    signal: AbortSignal.timeout(EDGEQUAKE_TIMEOUT),
  });

  if (!response.ok) {
    throw new Error(`EdgeQuake indexing failed: ${response.status} - ${await response.text()}`);
  }

  return response.json();
}

export async function healthCheck(): Promise<boolean> {
  try {
    const response = await fetch(`${EDGEQUAKE_URL}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
