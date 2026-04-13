/**
 * POST /api/sync/relay/pull — Trigger pull from relay and apply changes locally.
 */
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { pullFromRelay } from "@/lib/relay/sync-service";

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
