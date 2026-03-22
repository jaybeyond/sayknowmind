import { NextResponse } from "next/server";
import { ollamaListModels } from "@/lib/ollama/client";

export async function GET() {
  try {
    const models = await ollamaListModels();
    return NextResponse.json({ models });
  } catch {
    return NextResponse.json({ models: [], error: "Failed to fetch models" }, { status: 502 });
  }
}
