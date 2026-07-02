/**
 * Team feature, Phase 3 — the request's organization context.
 *
 * Every read/write of team data is scoped to the caller's *active
 * organization*, not just their user id. This resolver returns that context
 * and the caller's role within it, so routes can enforce membership-aware
 * isolation. Replaces the bare `getUserIdFromRequest()` for team resources.
 */
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";

export interface OrgContext {
  /** better-auth user id of the caller. */
  userId: string;
  /** Organization the caller is currently acting inside. */
  organizationId: string;
  /** Caller's role in that organization: 'owner' | 'admin' | 'member'. */
  role: string;
}

/** Owners and admins may write across the whole organization. */
export function isOrgAdmin(role: string): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Default visibility for a newly created resource.
 *
 * DB-10 (privacy-by-default): new resources are `private` (owner-only) until the
 * user explicitly shares them — even inside a team org. Previously team-org
 * resources defaulted to `shared`, so every teammate saw new content without an
 * explicit grant; that auto-exposure is the privacy violation the audit flagged.
 * Existing rows are untouched; this only governs the default for new inserts.
 * (Matches migration 065 flipping the column default to 'private'.)
 *
 * NOTE: this makes team collaboration opt-in per resource. If the product wants
 * team-shared-by-default, revert this to the personal-vs-team check.
 */
export async function resolveDefaultPrivacy(
  _organizationId: string | null | undefined,
  _userId: string,
): Promise<"private" | "shared"> {
  return "private";
}

/**
 * Resolve the caller's identity and active organization, verifying
 * membership in one query. Returns null when unauthenticated, or when the
 * user belongs to no organization (should not happen once 053 has run).
 *
 * The active org is taken from the session when present; for MCP-key auth
 * (no session) it falls back to the user's first membership. A pinned
 * `activeOrganizationId` the user is NOT a member of is ignored — the query
 * only ever returns organizations the user actually belongs to.
 */
export async function getOrgContext(): Promise<OrgContext | null> {
  const userId = await getUserIdFromRequest();
  if (!userId) return null;

  let activeOrgId: string | null = null;
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    activeOrgId =
      (session?.session as { activeOrganizationId?: string | null } | undefined)
        ?.activeOrganizationId ?? null;
  } catch {
    // No session (e.g. MCP API key) — fall back to first membership below.
  }

  // Returns a membership row only; the pinned active org wins the sort when
  // it is a real membership, otherwise the oldest membership is used.
  const result = await pool.query(
    `SELECT m."organizationId", m.role
       FROM member m
      WHERE m."userId" = $1
      ORDER BY (m."organizationId" = $2) DESC NULLS LAST, m."createdAt" ASC
      LIMIT 1`,
    [userId, activeOrgId],
  );
  const row = result.rows[0];
  if (!row) return null;

  return {
    userId,
    organizationId: row.organizationId as string,
    role: row.role as string,
  };
}
