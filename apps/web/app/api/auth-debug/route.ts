import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, string> = {
    node: process.version,
    DATABASE_URL: process.env.DATABASE_URL ? "set (" + process.env.DATABASE_URL.slice(0, 20) + "...)" : "NOT SET",
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ? "set (" + process.env.BETTER_AUTH_SECRET.length + " chars)" : "NOT SET",
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "NOT SET",
  };

  // Test pg import
  try {
    const pg = require("pg");
    checks.pg = "OK (" + typeof pg.Pool + ")";
  } catch (e: any) {
    checks.pg = "FAIL: " + e.message;
  }

  // Test better-auth import
  try {
    const ba = await import("better-auth");
    checks.betterAuth = "OK (" + typeof ba.betterAuth + ")";
  } catch (e: any) {
    checks.betterAuth = "FAIL: " + e.message;
  }

  // Test better-auth/next-js import
  try {
    const nj = await import("better-auth/next-js");
    checks.betterAuthNextJs = "OK (" + typeof nj.toNextJsHandler + ")";
  } catch (e: any) {
    checks.betterAuthNextJs = "FAIL: " + e.message;
  }

  // Test better-auth/cookies import
  try {
    const bc = await import("better-auth/cookies");
    checks.betterAuthCookies = "OK (" + typeof bc.getSessionCookie + ")";
  } catch (e: any) {
    checks.betterAuthCookies = "FAIL: " + e.message;
  }

  // Test full auth init
  try {
    const { auth } = await import("@/lib/auth");
    checks.authInit = "OK (" + typeof auth + ")";
    // Try accessing auth.api to trigger the Proxy
    checks.authApi = "OK (" + typeof auth.api + ")";
  } catch (e: any) {
    checks.authInit = "FAIL: " + e.message + "\n" + e.stack;
  }

  return NextResponse.json(checks, { status: 200 });
}
