/**
 * Non-streaming cloud AI client — shared by Telegram, AI Processor, and other
 * server-side callers that need a simple request→response (no SSE).
 *
 * Priority:
 * 1. Cloud providers (from .sayknowmind-providers.json via getOrderedProviders)
 * 2. AI server cascade (port 4000)
 */

import { getOrderedProviders, type ProviderEntry } from "@/lib/provider-config";

const AI_SERVER_URL = process.env.AI_SERVER_URL ?? "http://localhost:4000";
const AI_TIMEOUT = 60_000;

/**
 * HTTP status codes that trigger AI server fallback.
 * 400 = bad request (model not found, etc.)
 * 402 = payment required (quota exhausted)
 * 429 = rate limited
 */
const FALLBACK_CODES = new Set([400, 402, 429]);

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
 * Call AI server (non-streaming) with cascade fallback.
 * For vision requests, sends images as base64.
 */
async function callAiServer(
  system: string,
  message: string,
  timeout: number,
  images?: string[],
): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env.AI_API_KEY;
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const body: Record<string, unknown> = {
    messages: [
      { role: "system", content: system },
      { role: "user", content: message },
    ],
    stream: false,
  };
  if (images?.length) {
    body.images = images.map((img) => ({
      data: img.startsWith("data:") ? img.split(",")[1] ?? img : img,
      mimeType: "image/jpeg",
    }));
  }

  const res = await fetch(`${AI_SERVER_URL}/ai/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(images?.length ? 120_000 : timeout),
  });

  if (!res.ok) throw new Error(`AI server returned ${res.status}`);
  const data = await res.json();
  return data.content ?? "";
}

/**
 * Cloud-first AI call with AI server fallback.
 *
 * Tries each configured cloud provider in order (active first).
 * Falls back to AI server cascade when cloud returns 400, 402, or 429
 * (quota/rate-limit issues), or when no providers are configured.
 */
export async function callAiCloudFirst(opts: AiCallOptions): Promise<string> {
  const { system, message, images, timeout = AI_TIMEOUT } = opts;
  const providers = opts.providers ?? getOrderedProviders();

  let shouldFallback = false;

  // Try cloud providers in order
  for (const provider of providers) {
    try {
      return await callCloudProvider(provider, system, message, timeout, images);
    } catch (err) {
      console.warn(`[cloud-ai] ${provider.id} failed:`, (err as Error).message);
      if (err instanceof CloudHttpError && FALLBACK_CODES.has(err.status)) {
        shouldFallback = true;
      }
    }
  }

  // No providers configured → use AI server
  if (!shouldFallback) {
    if (providers.length > 0) {
      console.warn("[cloud-ai] Cloud providers failed with non-recoverable errors — skipping AI server fallback");
    } else {
      shouldFallback = true;
    }
  }

  if (shouldFallback) {
    console.warn(`[cloud-ai] Falling back to AI server cascade`);
    try {
      return await callAiServer(system, message, timeout, images);
    } catch (err) {
      console.error("[cloud-ai] AI server also failed:", (err as Error).message);
    }
  }

  return "";
}
