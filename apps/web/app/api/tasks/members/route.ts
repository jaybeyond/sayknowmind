import { NextRequest, NextResponse } from "next/server";
import { getOrgContext } from "@/lib/org-context";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";
import { getUserOrgs } from "@/lib/tasks/store";
import { isBiTasksEnabled, listBiTaskMembers } from "@/lib/integrations/bi-tasks";
import { biTaskErrorResponse } from "@/lib/tasks/bridge-error";

export const dynamic = "force-dynamic";

/**
 * GET /api/tasks/members — org members that can be assigned a task. Backs the
 * assignee picker; separate from the general team endpoints so the board only
 * pulls the id/name/email/image it renders.
 */
export async function GET(request: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }
  try {
    if (isBiTasksEnabled(ctx)) {
      const members = await listBiTaskMembers(ctx, request.nextUrl.searchParams.get("projectId"));
      return NextResponse.json({ members });
    }

    // Union of members across every org the caller belongs to, deduped — so the
    // assignee picker covers personal + team work in the cross-org task view.
    const orgs = await getUserOrgs(ctx.userId);
    if (orgs.allIds.length === 0) return NextResponse.json({ members: [] });
    const res = await pool.query(
      `SELECT DISTINCT u.id, u.name, u.email, u.image
         FROM member m
         JOIN "user" u ON u.id = m."userId"
        WHERE m."organizationId" = ANY($1)
        ORDER BY u.name ASC NULLS LAST, u.email ASC`,
      [orgs.allIds],
    );
    return NextResponse.json({ members: res.rows });
  } catch (err) {
    console.error("[tasks/members] GET error:", err);
    if (isBiTasksEnabled(ctx)) return biTaskErrorResponse(err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
