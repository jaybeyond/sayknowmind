/**
 * Chat router — cloud-first provider routing with AI server fallback.
 *
 * Priority:
 * 1. Try active cloud provider (first in array)
 * 2. If fails → try remaining cloud providers in order
 * 3. Fallback to AI server (port 4000) on 400/402/429 (quota/rate-limit)
 * 4. If no providers configured → go straight to AI server
 */

import { cloudStreamChat, type CloudProviderConfig } from "./cloud-chat";

const AI_SERVER_URL = process.env.AI_SERVER_URL ?? "http://localhost:4000";

/**
 * HTTP status codes that trigger AI server fallback.
 * 400 = bad request, 402 = payment required, 429 = rate limited.
 */
const FALLBACK_CODES = new Set([400, 402, 429]);

/** Extract HTTP status from error message like "Cloud provider 429: ..." */
function extractHttpStatus(errMsg: string): number | null {
  const match = errMsg.match(/\b(4\d{2}|5\d{2})\b/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Stream chat via AI server (NestJS cascade — OpenRouter, Grok, Venice, etc.)
 * Parses the AI server's SSE format: data: {"content":"..."} / data: {"done":true}
 */
async function aiServerStreamChat(
  systemPrompt: string,
  messages: { role: string; content: string }[],
  onToken: (token: string) => void,
  onReasoning?: (line: string) => void,
): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env.AI_API_KEY;
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(`${AI_SERVER_URL}/ai/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
      stream: true,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AI server ${res.status}: ${body.slice(0, 300)}`);
  }
  if (!res.body) throw new Error("AI server returned no stream body");

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

        // Stream end
        if (obj.done) continue;

        // Error from AI server
        if (obj.error) throw new Error(`AI server stream: ${obj.error}`);

        // Thinking summary
        if (obj.thinkingSummary && onReasoning) {
          onReasoning(obj.thinkingSummary);
          continue;
        }

        // Content token
        if (obj.content) {
          fullText += obj.content;
          onToken(obj.content);
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("AI server stream:")) throw e;
        // skip malformed SSE data
      }
    }
  }

  return fullText;
}

export interface ProviderInput {
  id: string;
  apiKey: string;
  model: string;
  baseUrl: string;
}

export async function routeChat(
  providers: ProviderInput[],
  systemPrompt: string,
  messages: { role: string; content: string }[],
  onToken: (token: string) => void,
  onReasoning?: (line: string) => void,
  onLog?: (msg: string) => void,
): Promise<string> {
  // Filter to only valid providers (have key + model)
  const validProviders = providers.filter((p) => p.apiKey && p.model && p.baseUrl);

  let shouldFallback = false;

  // Try each cloud provider in order (active first, then fallbacks)
  for (const provider of validProviders) {
    const config: CloudProviderConfig = {
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      model: provider.model,
    };

    try {
      onLog?.(`[router] Trying cloud: ${provider.id} (${provider.model})`);
      const result = await cloudStreamChat(config, systemPrompt, messages, onToken, onReasoning);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      onLog?.(`[router] ${provider.id} failed: ${msg}`);
      console.error(`[chat-router] ${provider.id} failed:`, msg);

      const status = extractHttpStatus(msg);
      if (status && FALLBACK_CODES.has(status)) {
        shouldFallback = true;
      }
    }
  }

  // No providers configured → use AI server
  if (validProviders.length === 0) {
    onLog?.("[router] No cloud providers configured — using AI server cascade");
    return aiServerStreamChat(systemPrompt, messages, onToken, onReasoning);
  }

  // Fall back to AI server on 400/402/429
  if (shouldFallback) {
    onLog?.("[router] Cloud returned 400/402/429 — falling back to AI server cascade");
    return aiServerStreamChat(systemPrompt, messages, onToken, onReasoning);
  }

  onLog?.("[router] All cloud providers failed with non-recoverable errors");
  throw new Error("All cloud providers failed");
}
