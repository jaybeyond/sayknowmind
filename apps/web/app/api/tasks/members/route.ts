import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/org-context";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/tasks/members — org members that can be assigned a task. Backs the
 * assignee picker; separate from the general team endpoints so the board only
 * pulls the id/name/email/image it renders.
 */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }
  try {
    const res = await pool.query(
      `SELECT u.id, u.name, u.email, u.image
         FROM member m
         JOIN "user" u ON u.id = m."userId"
        WHERE m."organizationId" = $1
        ORDER BY u.name ASC NULLS LAST, u.email ASC`,
      [ctx.organizationId],
    );
    return NextResponse.json({ members: res.rows });
  } catch (err) {
    console.error("[tasks/members] GET error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
