import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";

/**
 * POST /api/models/provider — Fetch available models from a cloud provider.
 * Proxies the /v1/models call server-side to avoid CORS issues.
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

  try {
    const url = `${baseUrl.replace(/\/$/, "")}/v1/models`;
    const res = await fetch(url, {
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
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
