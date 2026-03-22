/**
 * POST /api/sync/relay/pull — Trigger pull from relay and apply changes locally.
 */
import { NextResponse } from "next/server";
import { Pool } from "pg";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pullFromRelay } from "@/lib/relay/sync-service";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://postgres:password@localhost:5432/sayknowmind",
});

export async function POST() {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await pullFromRelay(pool, userId);

  return NextResponse.json({
    pulled: result.pulled,
    conflicts: result.conflicts,
    errors: result.errors,
  });
}
