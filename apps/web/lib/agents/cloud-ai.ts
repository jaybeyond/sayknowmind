/**
 * Non-streaming cloud AI client — shared by Telegram, AI Processor, and other
 * server-side callers that need a simple request→response (no SSE).
 *
 * Priority:
 * 1. Cloud providers (from .sayknowmind-providers.json via getOrderedProviders)
 * 2. AI server cascade (port 4000)
 */

import { getOrderedProviders, type ProviderEntry } from "@/lib/provider-config";
import { getUserProviders } from "@/lib/provider-db";
import { enqueueAndWait, type RelayProvider } from "@/lib/llm-relay/queue";

const AI_SERVER_URL = process.env.AI_SERVER_URL ?? "http://localhost:4000";
const AI_TIMEOUT = 60_000;

/** Provider IDs that live on the user's PC and must be routed through
 *  the relay rather than fetched directly from cloud. Keep in sync with
 *  ocp-status and codex-status integration routes. */
const RELAY_PROVIDER_IDS: ReadonlyArray<string> = ["ocp", "codex"];
function isRelayProvider(id: string): id is RelayProvider {
  return RELAY_PROVIDER_IDS.includes(id);
}

export interface AiCallOptions {
  system: string;
  message: string;
  /** Base64-encoded images for vision models */
  images?: string[];
  /** Override providers instead of reading from config */
  providers?: ProviderEntry[];
  /** User ID — loads encrypted providers from DB when set */
  userId?: string;
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
 *
 * For OCP/Codex (RELAY_PROVIDER_IDS) the call is routed through the LLM
 * relay queue: the user's running webview picks up the job, executes it
 * via Tauri (complete_via_ocp / complete_via_codex), and posts the
 * result back. To this function it just looks like an awaitable string.
 * Images are not supported on the relay path — Codex CLI's image input
 * is file-based and we don't ship a transfer mechanism here. Vision
 * callers should skip these providers and fall through to the next.
 */
async function callCloudProvider(
  provider: ProviderEntry,
  system: string,
  message: string,
  timeout: number,
  images?: string[],
  userId?: string,
): Promise<string> {
  if (isRelayProvider(provider.id)) {
    if (!userId) {
      throw new Error(`${provider.id} requires userId for relay routing`);
    }
    if (images?.length) {
      throw new Error(`${provider.id} relay does not support vision (images) yet`);
    }
    const result = await enqueueAndWait(
      userId,
      { system, user: message, model: provider.model || null, provider: provider.id },
      timeout,
    );
    if (!result.content) throw new Error(`${provider.id} returned empty content via relay`);
    return result.content;
  }

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
 * Always falls back to AI server if all cloud providers fail or none configured.
 */
export async function callAiCloudFirst(opts: AiCallOptions): Promise<string> {
  const { system, message, images, userId, timeout = AI_TIMEOUT } = opts;

  // Priority: explicit providers > DB (per-user) > JSON file/ENV fallback
  let providers = opts.providers;
  if (!providers && userId) {
    try {
      const dbProviders = await getUserProviders(userId);
      if (dbProviders.length > 0) providers = dbProviders;
    } catch (err) {
      console.warn("[cloud-ai] Failed to load DB providers:", err);
    }
  }
  if (!providers) providers = getOrderedProviders();

  // Try cloud providers in order. userId is required for the relay
  // branch (ocp/codex) — falls through to the next provider when
  // missing or when the user's webview isn't connected.
  for (const provider of providers) {
    try {
      return await callCloudProvider(provider, system, message, timeout, images, userId);
    } catch (err) {
      console.warn(`[cloud-ai] ${provider.id} failed:`, (err as Error).message);
    }
  }

  // All cloud providers failed (or none configured) → always fall back to AI server
  if (providers.length > 0) {
    console.warn("[cloud-ai] All cloud providers failed — falling back to AI server");
  }
  try {
    return await callAiServer(system, message, timeout, images);
  } catch (err) {
    console.error("[cloud-ai] AI server also failed:", (err as Error).message);
  }

  return "";
}
