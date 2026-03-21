export interface SayknowMindConfig {
  baseUrl: string;
  token?: string;
  timeout?: number;
}

export interface SearchParams {
  query: string;
  mode?: "naive" | "local" | "global" | "hybrid" | "mix";
  limit?: number;
  offset?: number;
  categoryIds?: string[];
  dateRange?: { start: string; end: string };
  tags?: string[];
}

export interface Citation {
  documentId: string;
  title: string;
  url?: string;
  excerpt: string;
  relevanceScore: number;
}

export interface SearchResult {
  documentId: string;
  title: string;
  snippet: string;
  score: number;
  citations: Citation[];
}

export interface SearchResponse {
  results: SearchResult[];
  totalCount: number;
  took: number;
}

export interface IngestUrlParams {
  url: string;
  categoryId?: string;
  tags?: string[];
}

export interface IngestTextParams {
  content: string;
  title?: string;
  categoryId?: string;
  tags?: string[];
}

export interface IngestResponse {
  documentId: string;
  jobId: string;
  title: string;
}

export interface ChatParams {
  message: string;
  conversationId?: string;
  mode?: "simple" | "agentic";
  documentIds?: string[];
  categoryIds?: string[];
}

export interface ChatResponse {
  conversationId: string;
  messageId: string;
  answer: string;
  citations: Citation[];
  relatedDocuments: string[];
}

export interface ChatStreamEvent {
  type: "text" | "citation" | "step" | "done" | "error";
  data: string;
}

export interface Category {
  id: string;
  name: string;
  parentId?: string;
  description?: string;
  color?: string;
  depth: number;
  path: string;
}

export interface CreateCategoryParams {
  name: string;
  parentId?: string;
  description?: string;
  color?: string;
}

export interface SayknowMindError {
  code: number;
  message: string;
  details?: unknown;
}
