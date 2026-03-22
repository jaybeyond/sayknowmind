/**
 * POST /api/sync/relay/push — Trigger push of pending local changes to relay.
 */
import { NextResponse } from "next/server";
import { Pool } from "pg";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pushPendingChanges } from "@/lib/relay/sync-service";

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ?? "postgres://postgres:password@localhost:5432/sayknowmind",
});

export async function POST() {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await pushPendingChanges(pool, userId);

  return NextResponse.json({
    pushed: result.pushed,
    errors: result.errors,
  });
}
