const OLLAMA_URL =
  process.env.OLLAMA_URL ??
  `http://localhost:${process.env.OLLAMA_PORT ?? "11434"}`;

// ─── Types ──────────────────────────────────────────────────

export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
  details?: {
    format: string;
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

export interface PullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

export interface ModelDetail {
  modelfile: string;
  parameters: string;
  template: string;
  details: {
    format: string;
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

// ─── Health check ───────────────────────────────────────────

export async function ollamaHealth(): Promise<boolean> {
  try {
    const res = await fetch(OLLAMA_URL, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── List installed models ──────────────────────────────────

export async function ollamaListModels(): Promise<OllamaModel[]> {
  const res = await fetch(`${OLLAMA_URL}/api/tags`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
  const data = await res.json();
  return data.models ?? [];
}

// ─── Pull (download) a model — returns a ReadableStream ─────

export async function ollamaPullStream(
  name: string
): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(`${OLLAMA_URL}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, stream: true }),
  });
  if (!res.ok) throw new Error(`Ollama pull failed: ${res.status}`);
  if (!res.body) throw new Error("No response body from Ollama");
  return res.body;
}

// ─── Delete a model ─────────────────────────────────────────

export async function ollamaDeleteModel(name: string): Promise<void> {
  const res = await fetch(`${OLLAMA_URL}/api/delete`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`Ollama delete failed: ${res.status}`);
}

// ─── Show model details ────────────────────────────────────

export async function ollamaShowModel(name: string): Promise<ModelDetail> {
  const res = await fetch(`${OLLAMA_URL}/api/show`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`Ollama show failed: ${res.status}`);
  return res.json();
}
