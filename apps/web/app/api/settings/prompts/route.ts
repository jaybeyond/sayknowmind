import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

const PROMPTS_FILE = join(process.cwd(), ".sayknowmind-prompts.json");

export interface CustomPrompts {
  summary: string;
  whatItSolves: string;
  keyPoints: string;
  tags: string;
}

const DEFAULT_PROMPTS: CustomPrompts = {
  summary: "2-3 sentence summary",
  whatItSolves: "1-2 sentences describing what problem/question this content addresses",
  keyPoints: "array of 3-7 key bullet points",
  tags: "array of 3-10 lowercase tags/keywords",
};

function readPrompts(): CustomPrompts {
  try {
    if (existsSync(PROMPTS_FILE)) {
      const data = JSON.parse(readFileSync(PROMPTS_FILE, "utf-8"));
      return { ...DEFAULT_PROMPTS, ...data };
    }
  } catch {
    // ignore
  }
  return DEFAULT_PROMPTS;
}

/** GET /api/settings/prompts — read custom prompts */
export async function GET() {
  return NextResponse.json({
    prompts: readPrompts(),
    defaults: DEFAULT_PROMPTS,
  });
}

/** POST /api/settings/prompts — save custom prompts */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const prompts = readPrompts();

    if (typeof body.summary === "string") prompts.summary = body.summary;
    if (typeof body.whatItSolves === "string") prompts.whatItSolves = body.whatItSolves;
    if (typeof body.keyPoints === "string") prompts.keyPoints = body.keyPoints;
    if (typeof body.tags === "string") prompts.tags = body.tags;

    writeFileSync(PROMPTS_FILE, JSON.stringify(prompts, null, 2));

    return NextResponse.json({ prompts });
  } catch {
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}
