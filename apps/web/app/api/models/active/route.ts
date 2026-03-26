import { NextRequest, NextResponse } from "next/server";
import { readModelConfig, writeModelConfig, type ModelRole } from "@/lib/model-config";

const VALID_ROLES: ModelRole[] = ["chat", "ocr", "embedding"];

export async function GET() {
  const config = readModelConfig();
  return NextResponse.json(config);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { model, role, ollamaEnabled } = body as {
    model?: string;
    role?: string;
    ollamaEnabled?: boolean;
  };

  // Toggle ollamaEnabled without requiring model
  if (typeof ollamaEnabled === "boolean") {
    const config = writeModelConfig({ ollamaEnabled });
    return NextResponse.json({ ...config, ok: true });
  }

  if (!model || typeof model !== "string") {
    return NextResponse.json({ error: "Model name required" }, { status: 400 });
  }

  // If role specified, set that role only. Otherwise set chat (backwards compat).
  const targetRole: ModelRole = VALID_ROLES.includes(role as ModelRole)
    ? (role as ModelRole)
    : "chat";

  const config = writeModelConfig({ [targetRole]: model });
  return NextResponse.json({ ...config, ok: true });
}
