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
    return this.request<SearchResponse>("/api/search", {
      method: "POST",
      body: JSON.stringify({ query, ...params }),
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

  async chat(params: ChatParams): Promise<ChatResponse> {
    return this.request<ChatResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  async *chatStream(params: ChatParams): AsyncGenerator<ChatStreamEvent> {
    const url = `${this.baseUrl}/api/chat`;
    const response = await fetch(url, {
      method: "POST",
      headers: { ...this.headers(), Accept: "text/event-stream" },
      body: JSON.stringify({ ...params, stream: true }),
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
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            yield { type: "done", data: "" };
            return;
          }
          try {
            const parsed = JSON.parse(data);
            yield parsed as ChatStreamEvent;
          } catch {
            yield { type: "text", data };
          }
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

  async createCategory(params: CreateCategoryParams): Promise<Category> {
    return this.request<Category>("/api/categories", {
      method: "POST",
      body: JSON.stringify(params),
    });
  }
}
