import { NextRequest, NextResponse } from "next/server";
import { getOrgContext, isOrgAdmin } from "@/lib/org-context";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";
import { readableClause, writableClause, type ShareableResource } from "@/lib/visibility";

export const dynamic = "force-dynamic";

/** POST /api/shares — grant a share */
export async function POST(request: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  let body: {
    resourceType?: unknown;
    resourceId?: unknown;
    granteeEmail?: unknown;
    permission?: unknown;
  } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "Invalid JSON body", timestamp: new Date().toISOString() },
      { status: 400 },
    );
  }

  const { resourceType, resourceId, granteeEmail, permission = "view" } = body;

  if (
    (resourceType !== "document" && resourceType !== "category") ||
    typeof resourceId !== "string" || !resourceId ||
    typeof granteeEmail !== "string" || !granteeEmail ||
    (permission !== "view" && permission !== "edit")
  ) {
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "resourceType, resourceId, granteeEmail, and optional permission ('view'|'edit') are required", timestamp: new Date().toISOString() },
      { status: 400 },
    );
  }

  const rt = resourceType as ShareableResource;
  const table = rt === "document" ? "documents" : "categories";
  const admin = isOrgAdmin(ctx.role);

  // Verify the caller can write the resource (creator or org admin).
  // params: $1 = resourceId, $2 = ctx.userId, $3 = ctx.organizationId
  const resourceCheck = await pool.query(
    `SELECT id FROM ${table} WHERE id = $1 AND ${writableClause(table, 3, 2, admin)}`,
    [resourceId, ctx.userId, ctx.organizationId],
  );
  if (resourceCheck.rows.length === 0) {
    // Distinguish not-found from forbidden: check if the row exists at all in the org.
    const existsCheck = await pool.query(
      `SELECT id FROM ${table} WHERE id = $1 AND organization_id = $2`,
      [resourceId, ctx.organizationId],
    );
    if (existsCheck.rows.length === 0) {
      return NextResponse.json(
        { code: ErrorCode.SEARCH_NO_RESULTS, message: "Resource not found", timestamp: new Date().toISOString() },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { code: ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS, message: "Forbidden", timestamp: new Date().toISOString() },
      { status: 403 },
    );
  }

  // Resolve grantee: must be a member of the same org.
  // params: $1 = granteeEmail, $2 = ctx.organizationId
  const granteeResult = await pool.query(
    `SELECT u.id
       FROM "user" u
       JOIN member m ON m."userId" = u.id
      WHERE u.email = $1 AND m."organizationId" = $2
      LIMIT 1`,
    [granteeEmail, ctx.organizationId],
  );
  if (granteeResult.rows.length === 0) {
    return NextResponse.json(
      { code: ErrorCode.SEARCH_NO_RESULTS, message: "Grantee not found in organization", timestamp: new Date().toISOString() },
      { status: 404 },
    );
  }
  const granteeUserId = granteeResult.rows[0].id as string;

  // Upsert the share.
  const shareResult = await pool.query(
    `INSERT INTO resource_shares (resource_type, resource_id, grantee_user_id, permission, granted_by, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (resource_type, resource_id, grantee_user_id)
     DO UPDATE SET permission = EXCLUDED.permission
     RETURNING id, resource_type, resource_id, grantee_user_id, permission, granted_by, organization_id, created_at`,
    [rt, resourceId, granteeUserId, permission, ctx.userId, ctx.organizationId],
  );

  return NextResponse.json(shareResult.rows[0], { status: 200 });
}

/** GET /api/shares?resourceType=&resourceId= — list shares */
export async function GET(request: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const { searchParams } = request.nextUrl;
  const resourceType = searchParams.get("resourceType");
  const resourceId = searchParams.get("resourceId");

  if ((resourceType !== "document" && resourceType !== "category") || !resourceId) {
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "resourceType and resourceId query params are required", timestamp: new Date().toISOString() },
      { status: 400 },
    );
  }

  const rt = resourceType as ShareableResource;
  const table = rt === "document" ? "documents" : "categories";

  // Caller must be able to read the resource.
  // params: $1 = resourceId, $2 = ctx.userId, $3 = ctx.organizationId
  const readCheck = await pool.query(
    `SELECT id FROM ${table} WHERE id = $1 AND ${readableClause(table, 3, 2, rt)}`,
    [resourceId, ctx.userId, ctx.organizationId],
  );
  if (readCheck.rows.length === 0) {
    return NextResponse.json(
      { code: ErrorCode.SEARCH_NO_RESULTS, message: "Resource not found", timestamp: new Date().toISOString() },
      { status: 404 },
    );
  }

  const sharesResult = await pool.query(
    `SELECT rs.id, rs.permission, rs.granted_by, rs.created_at,
            u.id AS grantee_id, u.name AS grantee_name, u.email AS grantee_email
       FROM resource_shares rs
       JOIN "user" u ON u.id = rs.grantee_user_id
      WHERE rs.resource_type = $1 AND rs.resource_id = $2 AND rs.organization_id = $3
      ORDER BY rs.created_at ASC`,
    [rt, resourceId, ctx.organizationId],
  );

  const shares = sharesResult.rows.map((row: { id: string; permission: string; granted_by: string; created_at: Date; grantee_id: string; grantee_name: string | null; grantee_email: string }) => ({
    id: row.id as string,
    permission: row.permission as string,
    granted_by: row.granted_by as string,
    created_at: row.created_at as Date,
    grantee: {
      id: row.grantee_id as string,
      name: row.grantee_name as string | null,
      email: row.grantee_email as string,
    },
  }));

  return NextResponse.json({ shares });
}

/** DELETE /api/shares?id= — revoke a share */
export async function DELETE(request: NextRequest) {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const shareId = request.nextUrl.searchParams.get("id");
  if (!shareId) {
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "id query param is required", timestamp: new Date().toISOString() },
      { status: 400 },
    );
  }

  // Load the share — must be in the caller's org.
  // params: $1 = shareId, $2 = ctx.organizationId
  const shareCheck = await pool.query(
    `SELECT id, granted_by FROM resource_shares WHERE id = $1 AND organization_id = $2`,
    [shareId, ctx.organizationId],
  );
  if (shareCheck.rows.length === 0) {
    return NextResponse.json(
      { code: ErrorCode.SEARCH_NO_RESULTS, message: "Share not found", timestamp: new Date().toISOString() },
      { status: 404 },
    );
  }

  const grantedBy = shareCheck.rows[0].granted_by as string;
  if (grantedBy !== ctx.userId && !isOrgAdmin(ctx.role)) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_INSUFFICIENT_PERMISSIONS, message: "Forbidden", timestamp: new Date().toISOString() },
      { status: 403 },
    );
  }

  await pool.query(`DELETE FROM resource_shares WHERE id = $1`, [shareId]);

  return NextResponse.json({ deleted: true, id: shareId });
}
