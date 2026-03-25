/**
 * Chat router — cloud-first provider routing with selective fallback.
 *
 * Priority:
 * 1. Try active cloud provider (first in array)
 * 2. If fails → try remaining cloud providers in order
 * 3. Only fallback to local Ollama on 400/402/429 (quota/rate-limit)
 * 4. If no providers configured → go straight to Ollama
 */

import { cloudStreamChat, type CloudProviderConfig } from "./cloud-chat";
import { ollamaStreamChat } from "./ollama";

/**
 * HTTP status codes that trigger Ollama fallback.
 * 400 = bad request, 402 = payment required, 429 = rate limited.
 */
const OLLAMA_FALLBACK_CODES = new Set([400, 402, 429]);

/** Extract HTTP status from error message like "Cloud provider 429: ..." */
function extractHttpStatus(errMsg: string): number | null {
  const match = errMsg.match(/\b(4\d{2}|5\d{2})\b/);
  return match ? parseInt(match[1], 10) : null;
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

  let shouldFallbackToOllama = false;

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
      if (status && OLLAMA_FALLBACK_CODES.has(status)) {
        shouldFallbackToOllama = true;
      }
    }
  }

  // No providers configured → must use Ollama
  if (validProviders.length === 0) {
    onLog?.("[router] No cloud providers configured — using local Ollama (1.7b)");
    return ollamaStreamChat(systemPrompt, messages, onToken, onReasoning);
  }

  // Only fall back to Ollama on 400/402/429
  if (shouldFallbackToOllama) {
    onLog?.("[router] Cloud returned 400/402/429 — falling back to local Ollama (1.7b)");
    return ollamaStreamChat(systemPrompt, messages, onToken, onReasoning);
  }

  onLog?.("[router] All cloud providers failed with non-recoverable errors — no Ollama fallback");
  throw new Error("All cloud providers failed");
}
