/**
 * GET /api/sync/relay/status — Get relay sync status.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { getRelaySyncStatus } from "@/lib/relay/sync-service";

export async function GET() {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const status = await getRelaySyncStatus(pool, userId);

  return NextResponse.json(status);
}
