/**
 * SQL helpers for multitenant read/write scoping.
 *
 * Read paths may access documents/categories owned by the current user or
 * explicitly shared by another user. Write paths must stay owner-only.
 *
 * `alias` must be a static SQL alias from the caller; never pass user input.
 */
export function visibilityClause(alias: string, userIdParam: number): string {
  return `(${alias}.user_id = $${userIdParam} OR ${alias}.privacy_level = 'shared')`;
}

export function writableClause(alias: string, userIdParam: number): string {
  return `${alias}.user_id = $${userIdParam}`;
}
