import type {
  SayknowMindConfig,
  SearchParams,
  SearchResponse,
  IngestUrlParams,
  IngestTextParams,
  IngestResponse,
  ChatParams,
  ChatResponse,
  ChatStreamEvent,
  Category,
  CreateCategoryParams,
  Citation,
} from "./types.js";

export class SayknowMindClient {
  private baseUrl: string;
  private token?: string;
  private timeout: number;

  constructor(config: SayknowMindConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.token = config.token;
    this.timeout = config.timeout ?? 30000;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) h["Authorization"] = `Bearer ${this.token}`;
    return h;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: { ...this.headers(), ...(options.headers as Record<string, string>) },
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const body = await response.text();
      let parsed: { code?: number; message?: string } = {};
      try { parsed = JSON.parse(body); } catch {}
      throw new Error(
        parsed.message ?? `HTTP ${response.status}: ${response.statusText}`,
      );
    }

    return response.json() as Promise<T>;
  }

  // -------------------------------------------------------------------------
  // Search
  // -------------------------------------------------------------------------

  async search(query: string, params?: Omit<SearchParams, "query">): Promise<SearchResponse> {
    // Extract filter fields and nest them under `filters` as the server expects.
    const { categoryIds, dateRange, tags, ...rest } = params ?? {};
    const filters: { categoryIds?: string[]; dateRange?: { start: string; end: string }; tags?: string[] } = {};
    if (categoryIds?.length) filters.categoryIds = categoryIds;
    if (dateRange) filters.dateRange = dateRange;
    if (tags?.length) filters.tags = tags;

    return this.request<SearchResponse>("/api/search", {
      method: "POST",
      body: JSON.stringify({
        query,
        ...rest,
        ...(Object.keys(filters).length > 0 ? { filters } : {}),
      }),
    });
  }

  // -------------------------------------------------------------------------
  // Ingestion
  // -------------------------------------------------------------------------

  async ingestUrl(params: IngestUrlParams): Promise<IngestResponse> {
    return this.request<IngestResponse>("/api/ingest/url", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async ingestFile(file: Blob, filename: string): Promise<IngestResponse> {
    const formData = new FormData();
    formData.append("file", file, filename);
    const url = `${this.baseUrl}/api/ingest/file`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      body: formData,
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
    return response.json() as Promise<IngestResponse>;
  }

  async ingestText(params: IngestTextParams): Promise<IngestResponse> {
    return this.request<IngestResponse>("/api/ingest/text", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  // -------------------------------------------------------------------------
  // Chat
  // -------------------------------------------------------------------------

  /**
   * Send a chat message and aggregate the full SSE stream into a ChatResponse.
   * The server always returns text/event-stream; this method consumes it and
   * collects answer tokens, sources, conversationId, and messageId.
   */
  async chat(params: ChatParams): Promise<ChatResponse> {
    const url = `${this.baseUrl}/api/chat`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(params),
      // Chat streams can be slow; give 3× the base timeout.
      signal: AbortSignal.timeout(this.timeout * 3),
    });

    if (!response.ok || !response.body) {
      const body = await response.text();
      let parsed: { code?: number; message?: string } = {};
      try { parsed = JSON.parse(body); } catch {}
      throw new Error(parsed.message ?? `HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const answerTokens: string[] = [];
    const citations: Citation[] = [];
    let conversationId = "";
    let messageId = "";

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") break outer;
        try {
          const ev = JSON.parse(data) as ChatStreamEvent;
          if (ev.type === "answer") {
            answerTokens.push(ev.token);
          } else if (ev.type === "sources") {
            for (const s of ev.sources) {
              citations.push({
                documentId: s.id,
                title: s.title,
                url: s.url,
                excerpt: s.excerpt,
                relevanceScore: s.score,
              });
            }
          } else if (ev.type === "done") {
            conversationId = ev.conversationId;
            messageId = ev.messageId;
          }
        } catch {
          // Skip malformed SSE lines.
        }
      }
    }

    return {
      conversationId,
      messageId,
      answer: answerTokens.join(""),
      citations,
      relatedDocuments: [],
    };
  }

  /**
   * Stream chat events as an async generator.
   * Each yielded event matches the server SSE schema exactly.
   */
  async *chatStream(params: ChatParams): AsyncGenerator<ChatStreamEvent> {
    const url = `${this.baseUrl}/api/chat`;
    const response = await fetch(url, {
      method: "POST",
      headers: { ...this.headers(), Accept: "text/event-stream" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(this.timeout * 3),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Chat stream failed: ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (data === "[DONE]") {
          yield { type: "done", conversationId: "", messageId: "" };
          return;
        }
        try {
          yield JSON.parse(data) as ChatStreamEvent;
        } catch {
          // Skip malformed SSE lines.
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------

  async getCategories(): Promise<Category[]> {
    const response = await this.request<{ categories: Category[] }>("/api/categories");
    return response.categories;
  }

  /**
   * Create a category.
   * Server returns `{categoryId, name, path: string[]}` — maps to `Category`.
   */
  async createCategory(params: CreateCategoryParams): Promise<Category> {
    const raw = await this.request<{ categoryId: string; name: string; path: string[] }>("/api/categories", {
      method: "POST",
      body: JSON.stringify(params),
    });
    return {
      id: raw.categoryId,
      name: raw.name,
      // path comes back as an array of segments; join to slash-delimited string.
      path: raw.path.join("/"),
      depth: raw.path.length > 0 ? raw.path.length - 1 : 0,
    };
  }
}
