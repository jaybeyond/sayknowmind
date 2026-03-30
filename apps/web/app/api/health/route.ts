import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms)
    ),
  ]);
}

export async function GET() {
  const checks: Record<string, string> = {};

  // Check PostgreSQL with a 3s timeout so healthcheck never hangs
  try {
    const result = await withTimeout(pool.query("SELECT 1 AS ok"), 3000);
    checks.database = result.rows[0]?.ok === 1 ? "ok" : "degraded";
  } catch {
    checks.database = "unavailable";
  }

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
