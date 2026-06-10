/**
 * SQL helpers for team-scoped read/write isolation.
 *
 * Team feature, Phase 3: scoping moved from "owned by this user" to
 * "belongs to the caller's active organization". A resource is visible to a
 * teammate when it is shared with the team; private resources stay
 * creator-only. Writes are creator-only unless the caller is an org admin.
 *
 * `alias` must be a static SQL alias from the caller; never pass user input.
 * Param placeholders ($N) are 1-based positions in the caller's value array.
 */

/**
 * Read scope for tables that carry both `organization_id` and
 * `privacy_level` (documents, categories). The caller's OWN resources are
 * always visible regardless of which organization is currently active — teams
 * only ADD visibility (shared resources of the active org), they never hide
 * your own memories. Without the unconditional `user_id` match, switching the
 * active org (or a legacy/NULL `organization_id`) would make a user's own
 * private memories vanish entirely.
 *
 * Only ever broadens to the caller's own rows, so it cannot leak anyone else's.
 *
 * @param orgParam   placeholder index bound to the active organization id
 * @param userParam  placeholder index bound to the caller's user id
 */
export function visibilityClause(
  alias: string,
  orgParam: number,
  userParam: number,
): string {
  return `(${alias}.user_id = $${userParam} OR (${alias}.organization_id = $${orgParam} AND ${alias}.privacy_level <> 'private'))`;
}

/**
 * Read scope for org-scoped tables without a `privacy_level` column
 * (tags, conversations, ingestion_jobs, shared_content): everything that
 * belongs to the organization is visible to its members.
 */
export function orgScopeClause(alias: string, orgParam: number): string {
  return `${alias}.organization_id = $${orgParam}`;
}

/**
 * Write scope: the creator may always modify their own resource; org owners
 * and admins may modify anything in the organization.
 *
 * @param isAdmin  caller's role grants org-wide write (see `isOrgAdmin`)
 */
export function writableClause(
  alias: string,
  orgParam: number,
  userParam: number,
  isAdmin: boolean,
): string {
  // Both branches reference $userParam so callers can always pass userId in
  // their params array regardless of role. Without this Postgres rejects
  // the prepared statement with 42P18 (indeterminate_datatype) on the
  // admin path, where the placeholder would otherwise appear in no
  // expression that gives it a type.
  return isAdmin
    ? `(${alias}.organization_id = $${orgParam} AND $${userParam}::text IS NOT NULL)`
    : `(${alias}.organization_id = $${orgParam} AND ${alias}.user_id = $${userParam})`;
}

// ── Phase 4: per-resource ACL (resource_shares) ──────────────────────────────
// `resourceType` is always a code-side literal, never user input.

/** Resource kinds that support per-user sharing (resource_shares.resource_type). */
export type ShareableResource = "document" | "category";

/**
 * Read access granted by an explicit per-resource share: the row exists in
 * `resource_shares` with the caller as grantee. Reuses `userParam` — adds no
 * new placeholder.
 */
export function sharedWithClause(
  alias: string,
  userParam: number,
  resourceType: ShareableResource,
): string {
  return `EXISTS (SELECT 1 FROM resource_shares rs WHERE rs.resource_type = '${resourceType}' AND rs.resource_id = ${alias}.id AND rs.grantee_user_id = $${userParam})`;
}

/**
 * Full read scope for a shareable resource: visible to the team
 * (`visibilityClause`) OR explicitly shared with the caller. Drop-in
 * replacement for `visibilityClause` on documents/categories read paths —
 * same placeholders, plus the resource-type literal.
 */
export function readableClause(
  alias: string,
  orgParam: number,
  userParam: number,
  resourceType: ShareableResource,
): string {
  return `(${visibilityClause(alias, orgParam, userParam)} OR ${sharedWithClause(alias, userParam, resourceType)} OR ${teamSharedClause(alias, orgParam, resourceType)})`;
}

/**
 * Read access granted because the resource was shared into the caller's active
 * team (`resource_team_shares`). Lets one memory live in several teams at once,
 * beyond its single home `organization_id`. Reuses `orgParam` — adds no new
 * placeholder, so every existing `readableClause` caller picks this up for free.
 */
export function teamSharedClause(
  alias: string,
  orgParam: number,
  resourceType: ShareableResource,
): string {
  return `EXISTS (SELECT 1 FROM resource_team_shares rts WHERE rts.resource_type = '${resourceType}' AND rts.resource_id = ${alias}.id AND rts.organization_id = $${orgParam})`;
}

/**
 * Write access granted by an explicit 'edit' share. OR this into a write
 * check alongside `writableClause` to honour edit grants. Reuses `userParam`.
 */
export function editableViaShareClause(
  alias: string,
  userParam: number,
  resourceType: ShareableResource,
): string {
  return `EXISTS (SELECT 1 FROM resource_shares rs WHERE rs.resource_type = '${resourceType}' AND rs.resource_id = ${alias}.id AND rs.grantee_user_id = $${userParam} AND rs.permission = 'edit')`;
}
