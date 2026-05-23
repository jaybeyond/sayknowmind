import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/org-context";
import { orgScopeClause } from "@/lib/visibility";
import { pool } from "@/lib/db";
import { ErrorCode } from "@/lib/types";

export const dynamic = "force-dynamic";

/** GET /api/tags — list every tag in the caller's active organization */
export async function GET() {
  const ctx = await getOrgContext();
  if (!ctx) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }
  try {
    // orgScopeClause("t", 1) => "t.organization_id = $1"
    const result = await pool.query(
      `SELECT t.id, t.name, t.canonical_name, t.created_at
       FROM tags t
       WHERE ${orgScopeClause("t", 1)}
       ORDER BY t.name`,
      [ctx.organizationId],
    );
    return NextResponse.json({
      tags: result.rows.map((t: {
        id: string;
        name: string;
        canonical_name: string;
        created_at: string;
      }) => ({
        id: t.id,
        name: t.name,
        canonical_name: t.canonical_name,
        created_at: t.created_at,
      })),
    });
  } catch (err) {
    console.error("[tags] GET error:", err);
    return NextResponse.json(
      { code: ErrorCode.SYSTEM_INTERNAL_ERROR, message: "Internal server error", timestamp: new Date().toISOString() },
      { status: 500 },
    );
  }
}
