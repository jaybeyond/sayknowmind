import { NextRequest, NextResponse } from "next/server";

let cached: { GET: Function; POST: Function } | null = null;
let cachedError: string | null = null;

async function getHandler() {
  if (cached) return { handler: cached, error: null };
  if (cachedError) return { handler: null, error: cachedError };

  try {
    const [authMod, nextMod] = await Promise.all([
      import("@/lib/auth"),
      import("better-auth/next-js"),
    ]);
    cached = nextMod.toNextJsHandler(authMod.auth);
    return { handler: cached, error: null };
  } catch (e: unknown) {
    cachedError = e instanceof Error ? e.message + "\n" + e.stack : String(e);
    return { handler: null, error: cachedError };
  }
}

export async function GET(req: NextRequest, context: { params: Promise<{ all: string[] }> }) {
  const { handler, error } = await getHandler();
  if (!handler) {
    return NextResponse.json(
      { error: "Auth init failed", detail: error },
      { status: 503 },
    );
  }
  try {
    return await handler.GET(req, context);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message + "\n" + e.stack : String(e);
    return NextResponse.json(
      { error: "Auth GET handler error", detail: msg },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest, context: { params: Promise<{ all: string[] }> }) {
  const { handler, error } = await getHandler();
  if (!handler) {
    return NextResponse.json(
      { error: "Auth init failed", detail: error },
      { status: 503 },
    );
  }
  try {
    return await handler.POST(req, context);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message + "\n" + e.stack : String(e);
    return NextResponse.json(
      { error: "Auth POST handler error", detail: msg },
      { status: 500 },
    );
  }
}
