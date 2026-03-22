import { NextRequest, NextResponse } from "next/server";
import { ollamaDeleteModel, ollamaShowModel } from "@/lib/ollama/client";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
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
  const { name } = await params;
  try {
    await ollamaDeleteModel(decodeURIComponent(name));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to delete model" }, { status: 502 });
  }
}
