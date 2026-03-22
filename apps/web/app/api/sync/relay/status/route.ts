/**
 * GET /api/sync/relay/status — Get relay sync status.
 */
import { NextResponse } from "next/server";
import { Pool } from "pg";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { getRelaySyncStatus } from "@/lib/relay/sync-service";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://postgres:password@localhost:5432/sayknowmind",
});

export async function GET() {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await getRelaySyncStatus(pool, userId);

  return NextResponse.json(status);
}
