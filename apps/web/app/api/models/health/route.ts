import { NextResponse } from "next/server";
import { ollamaHealth } from "@/lib/ollama/client";

export async function GET() {
  const online = await ollamaHealth();
  return NextResponse.json({ online });
}
