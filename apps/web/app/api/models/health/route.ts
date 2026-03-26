import { NextResponse } from "next/server";
import { ollamaHealth } from "@/lib/ollama/client";
import { isOllamaEnabled } from "@/lib/model-config";

export async function GET() {
  if (!isOllamaEnabled()) {
    return NextResponse.json({ online: false });
  }
  const online = await ollamaHealth();
  return NextResponse.json({ online });
}
