import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { ErrorCode } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/invitations/mine
 *
 * The invitee-side "accept" surface. better-auth creates an invitation row but
 * sends no email (no `sendInvitationEmail` handler is configured), so an invited
 * user has no way to discover or accept an invite. This returns the pending team
 * invitations addressed to the current user's email — matched case-insensitively
 * so a synthesized employee-number email (`12345@sayknow.local`) lines up with
 * the account the user actually logs in with — joined with the org name so the UI
 * can show "You've been invited to <team>".
 *
 * Static segment, so it takes precedence over the dynamic /api/invitations/[id].
 */
export async function GET() {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const userRes = await pool.query(`SELECT email FROM "user" WHERE id = $1 LIMIT 1`, [userId]);
  const email = userRes.rows[0]?.email as string | undefined;
  if (!email) {
    return NextResponse.json({ invitations: [] });
  }

  const result = await pool.query(
    `SELECT i.id, i.role, i.status, i."expiresAt",
            o.id AS "organizationId", o.name AS "organizationName"
       FROM invitation i
       JOIN organization o ON o.id = i."organizationId"
      WHERE lower(i.email) = lower($1)
        AND i.status = 'pending'
        AND i."expiresAt" > now()
      ORDER BY i."expiresAt" DESC`,
    [email],
  );

  return NextResponse.json({
    invitations: result.rows.map((row: {
      id: string;
      role: string;
      status: string;
      expiresAt: Date;
      organizationId: string;
      organizationName: string;
    }) => ({
      id: row.id,
      role: row.role,
      status: row.status,
      expiresAt: row.expiresAt,
      organizationId: row.organizationId,
      organizationName: row.organizationName,
    })),
  });
}
