import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, string> = {};
  let healthy = true;

  // Check PostgreSQL
  try {
    const result = await pool.query("SELECT 1 AS ok");
    checks.database = result.rows[0]?.ok === 1 ? "ok" : "degraded";
  } catch {
    checks.database = "unavailable";
    healthy = false;
  }

  const status = healthy ? 200 : 503;
  return NextResponse.json(
    {
      status: healthy ? "healthy" : "unhealthy",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      checks,
    },
    { status },
  );
}
