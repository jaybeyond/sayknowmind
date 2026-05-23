/**
 * Centralized Redis key builder for the memory subsystem.
 *
 * Key scheme (with org context):
 *   org:{organizationId}:user:{userId}:memory
 *   org:{organizationId}:user:{userId}:entities
 *   org:{organizationId}:semantic:{userId}
 *   org:{organizationId}:semantic:index:{userId}
 *
 * Legacy fallback (no org context — backward-compatible):
 *   user:{userId}:memory
 *   user:{userId}:entities
 *   semantic:{userId}
 *   semantic:index:{userId}
 *
 * Session keys are scoped to the sessionId only (sessions are already
 * unique per conversation and do not need an extra org prefix).
 */

export class MemoryKeysHelper {
  private readonly orgPrefix: string;

  constructor(organizationId?: string) {
    this.orgPrefix = organizationId ? `org:${organizationId}:` : '';
  }

  /** user:{userId}:memory  |  org:{orgId}:user:{userId}:memory */
  userMemory(userId: string): string {
    return this.orgPrefix
      ? `${this.orgPrefix}user:${userId}:memory`
      : `user:${userId}:memory`;
  }

  /** user:{userId}:entities  |  org:{orgId}:user:{userId}:entities */
  userEntities(userId: string): string {
    return this.orgPrefix
      ? `${this.orgPrefix}user:${userId}:entities`
      : `user:${userId}:entities`;
  }

  /** semantic:{userId}  |  org:{orgId}:semantic:{userId} */
  semanticMemory(userId: string): string {
    return this.orgPrefix
      ? `${this.orgPrefix}semantic:${userId}`
      : `semantic:${userId}`;
  }

  /** semantic:index:{userId}  |  org:{orgId}:semantic:index:{userId} */
  semanticIndex(userId: string): string {
    return this.orgPrefix
      ? `${this.orgPrefix}semantic:index:${userId}`
      : `semantic:index:${userId}`;
  }
}
