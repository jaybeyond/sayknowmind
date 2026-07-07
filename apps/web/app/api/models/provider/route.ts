import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { validateUrl, safeFetch } from "@/lib/ingest/url-fetcher";
import { ErrorCode } from "@/lib/types";

/**
 * POST /api/models/provider — Fetch available models from a cloud provider.
 * Proxies the /v1/models call server-side to avoid CORS issues.
 *
 * SSRF guard: the caller-supplied baseUrl is validated via validateUrl() before
 * any network call is made.  validateUrl() DNS-resolves the hostname and rejects
 * private/internal address ranges (RFC-1918, loopback, link-local).  safeFetch()
 * re-validates on every redirect hop, closing the SSRF-via-redirect vector.
 */
export async function POST(request: NextRequest) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { baseUrl, apiKey, providerId } = body as {
    baseUrl?: string;
    apiKey?: string;
    providerId?: string;
  };

  if (!baseUrl || !apiKey) {
    return NextResponse.json({ error: "baseUrl and apiKey are required" }, { status: 400 });
  }

  // SSRF guard — validate base URL before constructing the full path.
  // validateUrl() rejects non-HTTP(S) schemes and private/internal IP ranges.
  try {
    await validateUrl(baseUrl);
  } catch {
    return NextResponse.json(
      { error: "Invalid or disallowed provider URL" },
      { status: 400 },
    );
  }

  const base = baseUrl.replace(/\/$/, "");

  // Per-provider model listing. Providers differ in path, auth, and response
  // shape, so each returns an empty dropdown unless handled here:
  //   • OpenAI-compatible (openrouter/openai/grok/nvidia/upstage/venice): GET
  //     /v1/models, Bearer, { data: [{ id }] }
  //   • anthropic:  same path but x-api-key + anthropic-version headers
  //   • google:     GET /v1beta/models?key=…, { models: [{ name }] }
  //   • zai:        GET /v4/models (Zhipu/GLM use v4, not v1), Bearer
  //   • cloudflare: GET {account}/ai/models/search, Bearer, { result: [{ name }] }
  type ModelListResponse = {
    data?: Array<{ id?: string; model?: string }>;
    models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
    result?: Array<{ name?: string }>;
  };
  // OpenAI-style { data: [{ id }] } (also tolerates { data: [{ model }] }).
  const parseOpenAiLike = (d: ModelListResponse): string[] =>
    (d.data ?? [])
      .map((m) => m.id ?? m.model)
      .filter((id): id is string => Boolean(id))
      .sort();

  let url: string;
  let headers: Record<string, string>;
  let parse: (data: ModelListResponse) => string[];

  switch (providerId) {
    case "google":
      url = `${base}/v1beta/models?key=${encodeURIComponent(apiKey)}`;
      headers = {};
      parse = (d) =>
        (d.models ?? [])
          .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
          .map((m) => String(m.name ?? "").replace(/^models\//, ""))
          .filter(Boolean)
          .sort();
      break;
    case "anthropic":
      url = `${base}/v1/models`;
      headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
      parse = parseOpenAiLike;
      break;
    case "zai":
      // Zhipu/Z.AI (base …/api/paas) list models at /v4/models, not /v1/models.
      url = `${base}/v4/models`;
      headers = { Authorization: `Bearer ${apiKey}` };
      parse = parseOpenAiLike;
      break;
    case "cloudflare":
      // Workers AI catalog (base ends …/ai): /models/search → { result: [{ name }] }.
      url = `${base}/models/search?task=Text%20Generation`;
      headers = { Authorization: `Bearer ${apiKey}` };
      parse = (d) =>
        (d.result ?? []).map((m) => m.name).filter((n): n is string => Boolean(n)).sort();
      break;
    default:
      // OpenAI-compatible providers (openrouter, openai, grok, nvidia, upstage, venice)
      url = `${base}/v1/models`;
      headers = { Authorization: `Bearer ${apiKey}` };
      parse = parseOpenAiLike;
  }

  try {
    // safeFetch re-validates every redirect target, preventing a public URL that
    // 302s to an internal address from bypassing the guard above (e.g. the
    // 169.254.169.254 cloud metadata endpoint).
    const res = await safeFetch(url, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Provider returned ${res.status}`, detail: text.slice(0, 200) },
        { status: res.status },
      );
    }

    const data = (await res.json()) as ModelListResponse;
    const models = parse(data);

    return NextResponse.json({ models });
  } catch (err) {
    // Distinguish SSRF/validation errors (redirect into a private range) from
    // ordinary network failures so callers get a 400, not a 502.
    if ((err as { code?: number }).code === ErrorCode.INGEST_INVALID_URL) {
      return NextResponse.json(
        { error: "Invalid or disallowed provider URL" },
        { status: 400 },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
