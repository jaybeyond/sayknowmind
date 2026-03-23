/**
 * Ollama client — uses OpenAI-compatible /v1 endpoint for stable streaming.
 * Pattern from pi-mono: Ollama's /v1/chat/completions returns proper SSE
 * instead of raw NDJSON, making streaming more reliable.
 */

const OLLAMA_URL =
  process.env.OLLAMA_URL ??
  `http://localhost:${process.env.OLLAMA_PORT ?? "11434"}`;
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen3:4b";
/** Stream timeout — generous for cold-start, qwen3:4b loads fast once warm */
const STREAM_TIMEOUT = 120_000;
/** Non-stream timeout */
const GENERATE_TIMEOUT = 60_000;
/** Keep model loaded indefinitely (-1) to avoid cold-start on every request */
const KEEP_ALIVE = -1;

/** Non-streaming generation — returns full text response */
export async function ollamaGenerate(
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
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
    signal: AbortSignal.timeout(GENERATE_TIMEOUT),
  });
  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

/** Streaming chat via OpenAI-compatible SSE endpoint */
export async function ollamaStreamChat(
  systemPrompt: string,
  messages: { role: string; content: string }[],
  onToken: (token: string) => void,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STREAM_TIMEOUT);

  try {
    const res = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
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
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Ollama ${res.status}: ${body.slice(0, 200)}`);
    }
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
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") continue;

        try {
          const obj = JSON.parse(payload);
          const delta = obj.choices?.[0]?.delta;
          if (!delta) continue;

          // Reasoning tokens (qwen3 thinking) — route separately via onReasoning
          const reasoning = delta.reasoning_content ?? delta.reasoning ?? null;
          if (reasoning) {
            onToken(`<think>${reasoning}</think>`);
          }

          // Content tokens — the actual answer
          const chunk = delta.content ?? "";
          if (chunk) {
            fullText += chunk;
            onToken(chunk);
          }
        } catch {
          // skip malformed SSE data
        }
      }
    }

    return fullText;
  } finally {
    clearTimeout(timeout);
  }
}

/** Preload model into memory so the first real request is fast */
export function warmupOllama(): void {
  fetch(`${OLLAMA_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: [{ role: "user", content: "hi" }],
      stream: false,
      max_tokens: 1,
      keep_alive: KEEP_ALIVE,
    }),
    signal: AbortSignal.timeout(GENERATE_TIMEOUT),
  }).catch(() => {
    // Ollama not available yet — will load on first real request
  });
}

// Auto-warmup on module load (server-side only)
if (typeof window === "undefined") {
  warmupOllama();
}
