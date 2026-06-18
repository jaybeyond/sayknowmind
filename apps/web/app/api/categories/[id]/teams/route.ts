import { NextRequest, NextResponse } from "next/server";
import { getOrgContext, type OrgContext } from "@/lib/org-context";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Per-collection team sharing — the category (collection) mirror of
 * /api/documents/[id]/teams. A collection has a single home org
 * (categories.organization_id) whose visibility is driven by privacy_level;
 * sharing it into ANY other team the caller belongs to is recorded in
 * resource_team_shares (resource_type = 'category'). Both are exposed behind one
 * uniform "is it shared to team X" toggle.
 *
 * Who may manage it is independent of the active org: the creator may always
 * manage it, as may an owner/admin of its home org.
 */
async function loadManageableCategory(
  id: string,
  ctx: OrgContext,
): Promise<{ organization_id: string | null; privacy_level: string } | null> {
  // $1 = id, $2 = caller user id
  const res = await pool.query(
    `SELECT c.organization_id, c.privacy_level
       FROM categories c
      WHERE c.id = $1
        AND (
          c.user_id = $2
          OR EXISTS (
            SELECT 1 FROM member m
             WHERE m."userId" = $2
               AND m."organizationId" = c.organization_id
               AND m.role IN ('owner', 'admin')
          )
        )`,
    [id, ctx.userId],
  );
  return res.rows[0] ?? null;
}

/** GET — the caller's teams and whether this collection is shared into each. */
export async function GET(_request: NextRequest, context: RouteContext) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorized();
  const { id } = await context.params;

  const category = await loadManageableCategory(id, ctx);
  if (!category) return notFound();

  // The caller's teams (their personal org is excluded — it is not a team).
  const teamsRes = await pool.query(
    `SELECT o.id, o.name
       FROM member m
       JOIN organization o ON o.id = m."organizationId"
      WHERE m."userId" = $1 AND o.slug <> $2
      ORDER BY o.name ASC`,
    [ctx.userId, `personal-${ctx.userId}`],
  );

  const sharedRes = await pool.query(
    `SELECT organization_id FROM resource_team_shares
      WHERE resource_type = 'category' AND resource_id = $1`,
    [id],
  );
  const sharedSet = new Set<string>(sharedRes.rows.map((r: { organization_id: string }) => r.organization_id));

  const teams = teamsRes.rows.map((t: { id: string; name: string }) => ({
    id: t.id,
    name: t.name,
    isHome: t.id === category.organization_id,
    shared:
      t.id === category.organization_id ? category.privacy_level === "shared" : sharedSet.has(t.id),
  }));

  return NextResponse.json({ teams });
}

/** POST { organizationId, shared } — share/unshare this collection with one team. */
export async function POST(request: NextRequest, context: RouteContext) {
  const ctx = await getOrgContext();
  if (!ctx) return unauthorized();
  const { id } = await context.params;

  let body: { organizationId?: unknown; shared?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }
  const { organizationId, shared } = body;
  if (typeof organizationId !== "string" || !organizationId || typeof shared !== "boolean") {
    return badRequest("organizationId (string) and shared (boolean) are required");
  }

  const category = await loadManageableCategory(id, ctx);
  if (!category) return notFound();

  // The caller can only share into a team they themselves belong to.
  const membership = await pool.query(
    `SELECT 1 FROM member WHERE "userId" = $1 AND "organizationId" = $2 LIMIT 1`,
    [ctx.userId, organizationId],
  );
  if (membership.rows.length === 0) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS, message: "Not a member of that team", timestamp: new Date().toISOString() },
      { status: 403 },
    );
  }

  if (organizationId === category.organization_id) {
    // The home team sees the collection via privacy_level, not a share row.
    await pool.query(
      `UPDATE categories SET privacy_level = $1, updated_at = NOW() WHERE id = $2`,
      [shared ? "shared" : "private", id],
    );
  } else if (shared) {
    await pool.query(
      `INSERT INTO resource_team_shares (resource_type, resource_id, organization_id, granted_by)
       VALUES ('category', $1, $2, $3)
       ON CONFLICT (resource_type, resource_id, organization_id) DO NOTHING`,
      [id, organizationId, ctx.userId],
    );
  } else {
    await pool.query(
      `DELETE FROM resource_team_shares
        WHERE resource_type = 'category' AND resource_id = $1 AND organization_id = $2`,
      [id, organizationId],
    );
  }

  return NextResponse.json({ ok: true, organizationId, shared });
}

function unauthorized() {
  return NextResponse.json(
    { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
    { status: 401 },
  );
}
function notFound() {
  return NextResponse.json(
    { code: ErrorCode.SEARCH_NO_RESULTS, message: "Resource not found", timestamp: new Date().toISOString() },
    { status: 404 },
  );
}
function badRequest(message: string) {
  return NextResponse.json(
    { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message, timestamp: new Date().toISOString() },
    { status: 400 },
  );
}
