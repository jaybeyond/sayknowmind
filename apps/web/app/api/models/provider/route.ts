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
  const { baseUrl, apiKey } = body as { baseUrl?: string; apiKey?: string };

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

  try {
    const url = `${baseUrl.replace(/\/$/, "")}/v1/models`;

    // safeFetch replaces the raw fetch() call.  It re-validates every redirect
    // target, preventing a public URL that 302s to an internal address from
    // bypassing the guard above (e.g. 169.254.169.254 cloud metadata endpoint).
    const res = await safeFetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Provider returned ${res.status}`, detail: text.slice(0, 200) },
        { status: res.status },
      );
    }

    const data = await res.json();

    // OpenAI-compatible format: { data: [{ id: "model-name", ... }] }
    const models: string[] = (data.data ?? [])
      .map((m: { id?: string }) => m.id)
      .filter(Boolean)
      .sort();

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
