/**
 * Non-streaming cloud AI client — shared by Telegram, AI Processor, and other
 * server-side callers that need a simple request→response (no SSE).
 *
 * Priority:
 * 1. Cloud providers (from .sayknowmind-providers.json via getOrderedProviders)
 * 2. Ollama (local fallback)
 */

import { getOrderedProviders, type ProviderEntry } from "@/lib/provider-config";
import { getModelForRole } from "@/lib/model-config";

const OLLAMA_URL = `http://localhost:${process.env.OLLAMA_PORT ?? "11434"}`;
const AI_TIMEOUT = 60_000;

/**
 * HTTP status codes that trigger Ollama fallback.
 * 400 = bad request (model not found, etc.)
 * 402 = payment required (quota exhausted)
 * 429 = rate limited
 * All other errors (500, timeout, network) → fail without loading local model.
 */
const OLLAMA_FALLBACK_CODES = new Set([400, 402, 429]);

export interface AiCallOptions {
  system: string;
  message: string;
  /** Base64-encoded images for vision models */
  images?: string[];
  /** Override providers instead of reading from config */
  providers?: ProviderEntry[];
  /** Timeout in ms (default 60s) */
  timeout?: number;
}

class CloudHttpError extends Error {
  status: number;
  constructor(provider: string, status: number, body: string) {
    super(`${provider} returned ${status}: ${body.slice(0, 200)}`);
    this.status = status;
  }
}

/**
 * Build OpenAI-compatible user message content.
 * Plain text → string, with images → content array with image_url parts.
 */
function buildUserContent(
  message: string,
  images?: string[],
): string | Array<{ type: string; text?: string; image_url?: { url: string } }> {
  if (!images?.length) return message;
  return [
    { type: "text", text: message },
    ...images.map((img) => ({
      type: "image_url" as const,
      image_url: { url: img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}` },
    })),
  ];
}

/**
 * Call a cloud provider using OpenAI-compatible /v1/chat/completions (non-streaming).
 */
async function callCloudProvider(
  provider: ProviderEntry,
  system: string,
  message: string,
  timeout: number,
  images?: string[],
): Promise<string> {
  const url = `${provider.baseUrl.replace(/\/$/, "")}/v1/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: buildUserContent(message, images) },
      ],
      stream: false,
    }),
    signal: AbortSignal.timeout(timeout),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new CloudHttpError(provider.id, res.status, body);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  if (!content) throw new Error(`${provider.id} returned empty content`);
  return content;
}

/**
 * Call Ollama directly (non-streaming). Uses lightweight 1.7b model.
 * For vision requests, uses the configured vision model.
 */
async function callOllama(
  system: string,
  message: string,
  timeout: number,
  images?: string[],
): Promise<string> {
  const isVision = !!images?.length;
  const model = isVision
    ? (process.env.VISION_MODEL ?? "glm-ocr")
    : getModelForRole("chat");

  const userMessage: Record<string, unknown> = { role: "user", content: message };
  if (isVision) userMessage.images = images;

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        userMessage,
      ],
      stream: false,
    }),
    signal: AbortSignal.timeout(isVision ? 120_000 : timeout),
  });

  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
  const data = await res.json();
  return data.message?.content ?? "";
}

/**
 * Cloud-first AI call with selective Ollama fallback.
 *
 * Tries each configured cloud provider in order (active first).
 * Only falls back to local Ollama when cloud returns 400, 402, or 429
 * (quota/rate-limit issues). Other errors (500, timeout, network) do NOT
 * trigger local fallback to avoid freezing the machine with heavy models.
 */
export async function callAiCloudFirst(opts: AiCallOptions): Promise<string> {
  const { system, message, images, timeout = AI_TIMEOUT } = opts;
  const providers = opts.providers ?? getOrderedProviders();

  let shouldFallbackToOllama = false;

  // Try cloud providers in order
  for (const provider of providers) {
    try {
      return await callCloudProvider(provider, system, message, timeout, images);
    } catch (err) {
      console.warn(`[cloud-ai] ${provider.id} failed:`, (err as Error).message);
      if (err instanceof CloudHttpError && OLLAMA_FALLBACK_CODES.has(err.status)) {
        shouldFallbackToOllama = true;
      }
    }
  }

  // Only fall back to Ollama on 400/402/429 (quota/rate-limit)
  if (!shouldFallbackToOllama) {
    if (providers.length > 0) {
      console.warn("[cloud-ai] Cloud providers failed with non-recoverable errors — skipping Ollama fallback");
    } else {
      // No providers configured at all → must use Ollama
      shouldFallbackToOllama = true;
    }
  }

  if (shouldFallbackToOllama) {
    console.warn(`[cloud-ai] Falling back to Ollama${images?.length ? " (vision)" : " (1.7b)"}`);
    try {
      return await callOllama(system, message, timeout, images);
    } catch (err) {
      console.error("[cloud-ai] Ollama also failed:", (err as Error).message);
    }
  }

  return "";
}
