/**
 * Ollama client for the agentic chat pipeline.
 * Provides structured output (JSON) and streaming chat.
 */

const OLLAMA_URL =
  process.env.OLLAMA_URL ??
  `http://localhost:${process.env.OLLAMA_PORT ?? "11434"}`;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3:4b";
const OLLAMA_TIMEOUT = 60_000;
/** Keep model loaded indefinitely (-1) to avoid cold-start on every request */
const KEEP_ALIVE = -1;

/** Non-streaming generation — returns full text response */
export async function ollamaGenerate(
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      stream: false,
      keep_alive: KEEP_ALIVE,
    }),
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT),
  });
  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
  const data = await res.json();
  return data.message?.content ?? "";
}

/** Streaming chat — calls onToken for each chunk, returns full accumulated text */
export async function ollamaStreamChat(
  systemPrompt: string,
  messages: { role: string; content: string }[],
  onToken: (token: string) => void,
): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      stream: true,
      keep_alive: KEEP_ALIVE,
    }),
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT),
  });

  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
  if (!res.body) throw new Error("Ollama returned no stream body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const chunk = obj.message?.content ?? "";
        if (chunk) {
          fullText += chunk;
          onToken(chunk);
        }
      } catch {
        // skip malformed NDJSON
      }
    }
  }

  return fullText;
}

/** Preload model into memory so the first real request is fast */
export function warmupOllama(): void {
  fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: "user", content: "hi" }],
      stream: false,
      keep_alive: KEEP_ALIVE,
    }),
    signal: AbortSignal.timeout(OLLAMA_TIMEOUT),
  }).catch(() => {
    // Ollama not available yet — will load on first real request
  });
}

// Auto-warmup on module load (server-side only)
if (typeof window === "undefined") {
  warmupOllama();
}
