import { NextRequest, NextResponse } from "next/server";

async function handleAuth(req: NextRequest) {
  try {
    const { auth } = await import("@/lib/auth");
    const response = await auth.handler(req);
    return response;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message + "\n" + e.stack : String(e);
    return NextResponse.json(
      { error: "Auth handler error", detail: msg },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  return handleAuth(req);
}

export async function POST(req: NextRequest) {
  return handleAuth(req);
}
