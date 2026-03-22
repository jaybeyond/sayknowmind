import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const CONFIG_PATH = join(process.cwd(), ".sayknowmind-active-model");

export async function GET() {
  try {
    const model = (await readFile(CONFIG_PATH, "utf-8")).trim();
    return NextResponse.json({ model });
  } catch {
    return NextResponse.json({ model: process.env.LLM_MODEL ?? "qwen3:1.7b" });
  }
}

export async function POST(req: NextRequest) {
  const { model } = await req.json();
  if (!model || typeof model !== "string") {
    return NextResponse.json({ error: "Model name required" }, { status: 400 });
  }
  await writeFile(CONFIG_PATH, model, "utf-8");
  return NextResponse.json({ model, ok: true });
}
