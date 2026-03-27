import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export function GET() {
  return NextResponse.json({ ok: true, msg: "auth test route works" });
}

export async function POST() {
  try {
    // Test: try creating a user via better-auth's internal API
    const ctx = await auth.api.signUpEmail({
      body: {
        name: "DiagTest",
        email: `diag-${Date.now()}@test.com`,
        password: "DiagPass1234!",
      },
    });
    // Clean up: delete the test user
    return NextResponse.json({ ok: true, userId: ctx.user?.id, token: !!ctx.token });
  } catch (err) {
    const error = err as Error & { status?: number; body?: unknown };
    return NextResponse.json({
      ok: false,
      error: error.message,
      status: error.status,
      body: error.body,
      stack: error.stack?.split("\n").slice(0, 5),
    }, { status: 500 });
  }
}
