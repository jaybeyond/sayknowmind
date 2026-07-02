import { NextRequest, NextResponse } from "next/server";
import { ollamaDeleteModel, ollamaShowModel } from "@/lib/ollama/client";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { name } = await params;
  try {
    const detail = await ollamaShowModel(decodeURIComponent(name));
    return NextResponse.json(detail);
  } catch {
    return NextResponse.json({ error: "Model not found" }, { status: 404 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  // Destructive: deletes a local Ollama model. The edge middleware only defers on
  // a present Bearer token, so authenticate here before touching anything.
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { name } = await params;
  try {
    await ollamaDeleteModel(decodeURIComponent(name));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete model" }, { status: 502 });
  }
}
