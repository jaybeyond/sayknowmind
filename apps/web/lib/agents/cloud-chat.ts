/**
 * Cloud provider streaming client — OpenAI-compatible /v1/chat/completions.
 * Works with: OpenRouter, OpenAI, Anthropic (via proxy), Grok, Upstage,
 * NVIDIA NIM, Cloudflare Workers AI, Venice, Z.AI, Google Gemini.
 *
 * Reuses the same SSE parsing + <think> filter pattern from ollama.ts.
 *
 * For OCP/Codex (provider IDs marked relay-only), this routes through
 * the LLM relay queue instead — the user's running webview executes
 * locally and posts back the final answer. We then emit it via
 * onToken in a single chunk so callers downstream see the same
 * "completed answer" shape.
 */

import { enqueueAndWait, type RelayProvider } from "@/lib/llm-relay/queue";

export interface CloudProviderConfig {
  /** Provider ID — required so the streaming path can decide whether
   *  to route through the relay (ocp/codex) or fetch directly. */
  id: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

const STREAM_TIMEOUT = 120_000;

const RELAY_PROVIDER_IDS: ReadonlyArray<string> = ["ocp", "codex"];
function isRelayProvider(id: string): id is RelayProvider {
  return RELAY_PROVIDER_IDS.includes(id);
}

export async function cloudStreamChat(
  config: CloudProviderConfig,
  systemPrompt: string,
  messages: { role: string; content: string }[],
  onToken: (token: string) => void,
  onReasoning?: (line: string) => void,
  userId?: string,
): Promise<string> {
  // Relay branch — webview executes via Tauri and posts the full reply.
  // No token-by-token streaming on this path; emit once at the end.
  if (isRelayProvider(config.id)) {
    if (!userId) {
      throw new Error(`${config.id} streaming requires userId for relay routing`);
    }
    // Collapse history into a single user-string the way chat_via_ocp
    // expects (transcript form). complete_via_* accepts system + user
    // separately though, so we fold history into the user message.
    const transcript = messages
      .map((m) => {
        const role = m.role === "user" ? "User" : m.role === "assistant" ? "Assistant" : "System";
        return `${role}: ${m.content}`;
      })
      .join("\n\n");
    const userBody = transcript + "\n\nReply as the assistant to the latest user message.";
    const result = await enqueueAndWait(
      userId,
      { system: systemPrompt, user: userBody, model: config.model || null, provider: config.id },
      STREAM_TIMEOUT,
    );
    if (!result.content) throw new Error(`${config.id} returned empty content via relay`);
    onToken(result.content);
    return result.content;
  }

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
