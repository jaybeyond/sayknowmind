import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/org-context";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";
import { touchPresence, onlineInOrg } from "@/lib/presence";

export const dynamic = "force-dynamic";

function unauthorized() {
  return NextResponse.json(
    { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
    { status: 401 },
  );
}

/**
 * POST /api/presence — heartbeat. Marks the caller online in their org and
 * returns the other members currently online. Clients call this on a ~30s
 * interval while a presence-aware page is open.
 */
export async function POST() {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorized();
  try {
    const me = await pool.query(`SELECT id, name, email, image FROM "user" WHERE id = $1`, [ctx.userId]);
    const row = me.rows[0];
    if (row) touchPresence(row, ctx.organizationId, Date.now());
    const online = onlineInOrg(ctx.organizationId, Date.now(), ctx.userId);
    return NextResponse.json({ online });
  } catch (err) {
    console.error("[presence] POST error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
