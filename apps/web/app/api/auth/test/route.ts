import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export function GET() {
  return NextResponse.json({
    ok: true,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "(not set)",
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "(not set)",
    TRUSTED_ORIGINS: process.env.TRUSTED_ORIGINS ?? "(not set)",
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ? "set" : "NOT SET",
    DATABASE_URL: process.env.DATABASE_URL ? "set" : "NOT SET",
  });
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
