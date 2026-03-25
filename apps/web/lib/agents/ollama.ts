/**
 * Ollama client — uses OpenAI-compatible /v1 endpoint for stable streaming.
 * Pattern from pi-mono: Ollama's /v1/chat/completions returns proper SSE
 * instead of raw NDJSON, making streaming more reliable.
 */

import { getModelForRole } from "@/lib/model-config";

const OLLAMA_URL =
  process.env.OLLAMA_URL ??
  `http://localhost:${process.env.OLLAMA_PORT ?? "11434"}`;

function getChatModel(): string {
  return process.env.OLLAMA_MODEL ?? getModelForRole("chat");
}
/** Stream timeout — generous for cold-start, qwen3:1.7b loads fast once warm */
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
      model: getChatModel(),
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
  onReasoning?: (line: string) => void,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STREAM_TIMEOUT);

  try {
    const res = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: getChatModel(),
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
    let reasoningBuffer = "";
    let inThinkTag = false;  // Track <think> blocks to filter from content

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

          // Reasoning tokens (qwen3 thinking) — buffer and emit complete lines
          const reasoning = delta.reasoning_content ?? delta.reasoning ?? null;
          if (reasoning && onReasoning) {
            reasoningBuffer += reasoning;
            const rLines = reasoningBuffer.split("\n");
            reasoningBuffer = rLines.pop() ?? "";
            for (const rl of rLines) {
              if (rl.trim()) onReasoning(rl.trim());
            }
          }

          // Content tokens — the actual answer
          // Filter <think>...</think> blocks that qwen3 may embed in content
          let chunk = delta.content ?? "";
          if (chunk) {
            // Handle <think> tags spanning multiple chunks
            if (inThinkTag) {
              const endIdx = chunk.indexOf("</think>");
              if (endIdx !== -1) {
                // Route thinking text to reasoning callback
                const thinkPart = chunk.slice(0, endIdx);
                if (thinkPart.trim() && onReasoning) onReasoning(thinkPart.trim());
                chunk = chunk.slice(endIdx + 8);
                inThinkTag = false;
              } else {
                if (chunk.trim() && onReasoning) onReasoning(chunk.trim());
                chunk = "";
              }
            }
            if (!inThinkTag && chunk.includes("<think>")) {
              const startIdx = chunk.indexOf("<think>");
              const before = chunk.slice(0, startIdx);
              const after = chunk.slice(startIdx + 7);
              const endIdx = after.indexOf("</think>");
              if (endIdx !== -1) {
                const thinkPart = after.slice(0, endIdx);
                if (thinkPart.trim() && onReasoning) onReasoning(thinkPart.trim());
                chunk = before + after.slice(endIdx + 8);
              } else {
                if (after.trim() && onReasoning) onReasoning(after.trim());
                chunk = before;
                inThinkTag = true;
              }
            }
            if (chunk) {
              fullText += chunk;
              onToken(chunk);
            }
          }
        } catch {
          // skip malformed SSE data
        }
      }
    }

    // Flush remaining reasoning buffer
    if (reasoningBuffer.trim() && onReasoning) {
      onReasoning(reasoningBuffer.trim());
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
      model: getChatModel(),
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

// No auto-warmup — Ollama is only used as fallback when cloud returns 400/402/429.
// Preloading models wastes RAM and can freeze the machine.
