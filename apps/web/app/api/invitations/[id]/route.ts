import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/invitations/:id
 *
 * Returns minimal public-safe info about an invitation so the accept page
 * can show the organization name without requiring the caller to be
 * already authenticated inside that organization.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_VALIDATION_ERROR, message: "id is required" },
      { status: 400 },
    );
  }

  const result = await pool.query(
    `SELECT i.id, i.email, i.role, i.status, i."expiresAt",
            o.id AS "organizationId", o.name AS "organizationName"
       FROM invitation i
       JOIN organization o ON o.id = i."organizationId"
      WHERE i.id = $1
      LIMIT 1`,
    [id],
  );

  if (result.rows.length === 0) {
    return NextResponse.json(
      { code: ErrorCode.SEARCH_NO_RESULTS, message: "Invitation not found" },
      { status: 404 },
    );
  }

  const row = result.rows[0];
  return NextResponse.json({
    id: row.id as string,
    email: row.email as string,
    role: row.role as string,
    status: row.status as string,
    expiresAt: row.expiresAt as Date,
    organizationId: row.organizationId as string,
    organizationName: row.organizationName as string,
  });
}
