import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, string> = {};

  // Check PostgreSQL (non-blocking — degraded is OK for healthcheck)
  try {
    const result = await pool.query("SELECT 1 AS ok");
    checks.database = result.rows[0]?.ok === 1 ? "ok" : "degraded";
  } catch {
    checks.database = "unavailable";
  }

  // App is healthy as long as the process is running
  // DB issues are reported but don't block deployment
  return NextResponse.json(
    {
      status: "healthy",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: 200 },
  );
}
