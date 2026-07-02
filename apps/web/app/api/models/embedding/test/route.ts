import { NextRequest, NextResponse } from "next/server";
import { testEmbeddingProvider } from "@/lib/edgequake/client";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";

export async function POST(request: NextRequest) {
  // Makes an outbound call with a caller-supplied apiKey — require real auth so a
  // junk Bearer (deferred, not validated, at the edge) can't drive it.
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await request.json();
    const { provider, model, apiKey } = body as {
      provider?: string;
      model?: string;
      apiKey?: string;
    };

    if (!provider || !model) {
      return NextResponse.json(
        { ok: false, error: "provider and model are required" },
        { status: 400 },
      );
    }

    const result = await testEmbeddingProvider({ provider, model, apiKey });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}
