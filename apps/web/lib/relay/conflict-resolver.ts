/**
 * Relay conflict detection and resolution.
 * Follows the same pattern as lib/sync.ts ConflictResolution.
 */
import type { RelayConflict, RelayConflictStrategy, SyncPayload } from "./types";

/**
 * Detect if a pulled payload conflicts with the local document.
 * Returns null if no conflict (safe to apply directly).
 */
export function detectConflict(
  localDoc: { id: string; updatedAt: Date; syncHash?: string },
  remotePayload: SyncPayload,
  sourceDeviceId: string,
): RelayConflict | null {
  // No conflict if hashes match — same content
  if (localDoc.syncHash === remotePayload.hash) return null;

  // No conflict if local hasn't changed since the remote's base sync time
  if (
    remotePayload.baseSyncedAt &&
    localDoc.updatedAt <= new Date(remotePayload.baseSyncedAt)
  ) {
    return null;
  }

  // Both sides changed — conflict
  return {
    id: `conflict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    documentId: localDoc.id,
    localVersion: {
      updatedAt: localDoc.updatedAt,
      hash: localDoc.syncHash ?? "",
    },
    remoteVersion: {
      updatedAt: new Date(remotePayload.timestamp),
      hash: remotePayload.hash,
      sourceDeviceId,
    },
    detectedAt: new Date(),
    resolved: false,
  };
}

/**
 * Resolve a conflict with the given strategy.
 * Returns which version wins and whether to create a copy.
 */
export function resolveConflict(
  conflict: RelayConflict,
  strategy: RelayConflictStrategy,
): { winner: "local" | "remote"; createCopy: boolean } {
  switch (strategy) {
    case "last_write_wins":
      return {
        winner:
          conflict.localVersion.updatedAt > conflict.remoteVersion.updatedAt
            ? "local"
            : "remote",
        createCopy: false,
      };
    case "keep_local":
      return { winner: "local", createCopy: false };
    case "keep_remote":
      return { winner: "remote", createCopy: false };
    case "keep_both":
      // Remote becomes a new document, local stays
      return { winner: "local", createCopy: true };
  }
}
