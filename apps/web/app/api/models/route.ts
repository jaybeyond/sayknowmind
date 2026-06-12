import { NextResponse } from "next/server";
import { ollamaListModels } from "@/lib/ollama/client";

export async function GET() {
  try {
    const models = await ollamaListModels();
    return NextResponse.json({ models });
  } catch {
    // Ollama is optional (only used for local model listing). When it's not
    // reachable — e.g. cloud mode using external APIs — return an empty list
    // with 200 so the model picker degrades gracefully instead of throwing a
    // 502 + console error on every load.
    return NextResponse.json({ models: [], unavailable: true });
  }
}
