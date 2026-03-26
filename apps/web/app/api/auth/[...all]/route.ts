import { NextRequest, NextResponse } from "next/server";

let handler: { GET: Function; POST: Function } | null = null;
let initError: string | null = null;

try {
  const { auth } = require("@/lib/auth");
  const { toNextJsHandler } = require("better-auth/next-js");
  handler = toNextJsHandler(auth);
} catch (e: unknown) {
  initError = e instanceof Error ? e.message + "\n" + e.stack : String(e);
}

export async function GET(req: NextRequest) {
  if (!handler) {
    return NextResponse.json({ error: "Auth init failed", detail: initError }, { status: 503 });
  }
  return handler.GET(req);
}

export async function POST(req: NextRequest) {
  if (!handler) {
    return NextResponse.json({ error: "Auth init failed", detail: initError }, { status: 503 });
  }
  return handler.POST(req);
}
