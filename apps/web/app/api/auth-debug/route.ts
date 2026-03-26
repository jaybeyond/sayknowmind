import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const checks: Record<string, string> = {
    node: process.version,
    DATABASE_URL: process.env.DATABASE_URL ? "set (" + process.env.DATABASE_URL.slice(0, 20) + "...)" : "NOT SET",
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ? "set (" + process.env.BETTER_AUTH_SECRET.length + " chars)" : "NOT SET",
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? "NOT SET",
    TRUSTED_ORIGINS: process.env.TRUSTED_ORIGINS ?? "NOT SET",
    requestUrl: req.url,
  };

  // Test DB connection
  try {
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const result = await pool.query("SELECT NOW() as now, current_database() as db");
    checks.dbConnection = "OK — " + result.rows[0].db + " @ " + result.rows[0].now;
    await pool.end();
  } catch (e: any) {
    checks.dbConnection = "FAIL: " + e.message;
  }

  // Test auth table exists
  try {
    const { Pool } = require("pg");
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const result = await pool.query(`SELECT COUNT(*) as cnt FROM "user"`);
    checks.userTable = "OK — " + result.rows[0].cnt + " users";
    await pool.end();
  } catch (e: any) {
    checks.userTable = "FAIL: " + e.message;
  }

  // Test auth handler directly
  try {
    const { auth } = await import("@/lib/auth");
    checks.authType = typeof auth;
    checks.authHandler = typeof auth.handler;

    // Try calling handler with a fake get-session request
    const testUrl = (process.env.BETTER_AUTH_URL || "http://localhost:3000") + "/api/auth/get-session";
    const testReq = new Request(testUrl, { method: "GET", headers: req.headers });
    const response = await auth.handler(testReq);
    checks.handlerStatus = String(response.status);
    const body = await response.text();
    checks.handlerBody = body.slice(0, 500);
  } catch (e: any) {
    checks.authHandler = "FAIL: " + e.message + "\n" + e.stack;
  }

  // Test POST sign-up
  try {
    const { auth } = await import("@/lib/auth");
    const signupUrl = (process.env.BETTER_AUTH_URL || "http://localhost:3000") + "/api/auth/sign-up/email";
    const signupReq = new Request(signupUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "debug-test@test.com", password: "DebugTest123!", name: "Debug" }),
    });
    const signupRes = await auth.handler(signupReq);
    checks.signupStatus = String(signupRes.status);
    const signupBody = await signupRes.text();
    checks.signupBody = signupBody.slice(0, 500);
  } catch (e: any) {
    checks.signupError = e.message + "\n" + (e.stack ?? "").slice(0, 500);
  }

  return NextResponse.json(checks, { status: 200 });
}
