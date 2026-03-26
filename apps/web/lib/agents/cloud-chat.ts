/**
 * Cloud provider streaming client — OpenAI-compatible /v1/chat/completions.
 * Works with: OpenRouter, OpenAI, Anthropic (via proxy), Grok, Upstage,
 * NVIDIA NIM, Cloudflare Workers AI, Venice, Z.AI, Google Gemini.
 *
 * Reuses the same SSE parsing + <think> filter pattern from ollama.ts.
 */

export interface CloudProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const STREAM_TIMEOUT = 120_000;

export async function cloudStreamChat(
  config: CloudProviderConfig,
  systemPrompt: string,
  messages: { role: string; content: string }[],
  onToken: (token: string) => void,
  onReasoning?: (line: string) => void,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STREAM_TIMEOUT);

  try {
    const url = `${config.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Cloud provider ${res.status}: ${body.slice(0, 300)}`);
    }
    if (!res.body) throw new Error("Cloud provider returned no stream body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = "";
    let buffer = "";
    let reasoningBuffer = "";
    let inThinkTag = false;

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

          // Reasoning tokens (some providers support this)
          const reasoning = delta.reasoning_content ?? delta.reasoning ?? null;
          if (reasoning && onReasoning) {
            reasoningBuffer += reasoning;
            const rLines = reasoningBuffer.split("\n");
            reasoningBuffer = rLines.pop() ?? "";
            for (const rl of rLines) {
              if (rl.trim()) onReasoning(rl.trim());
            }
          }

          // Content tokens — filter <think> blocks
          let chunk = delta.content ?? "";
          if (chunk) {
            if (inThinkTag) {
              const endIdx = chunk.indexOf("</think>");
              if (endIdx !== -1) {
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

    if (reasoningBuffer.trim() && onReasoning) {
      onReasoning(reasoningBuffer.trim());
    }

    return fullText;
  } finally {
    clearTimeout(timeout);
  }
}
