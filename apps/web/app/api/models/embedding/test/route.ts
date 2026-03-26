import { NextRequest, NextResponse } from "next/server";
import { testEmbeddingProvider } from "@/lib/edgequake/client";

export async function POST(request: NextRequest) {
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
