/**
 * Relay sync types shared across local server modules.
 */

export type SyncAction = "create" | "update" | "delete";
export type SyncEntityType = "document" | "category" | "entity" | "conversation" | "message";
export type SyncLedgerStatus = "pending" | "pushed" | "pulled" | "confirmed" | "failed";
export type RelayConflictStrategy = "last_write_wins" | "keep_local" | "keep_remote" | "keep_both";

export interface SyncPayload {
  type: SyncEntityType;
  action: SyncAction;
  data: Record<string, unknown>;
  timestamp: number;
  hash: string;
  baseSyncedAt?: string; // ISO — last known sync time for conflict detection
}

export interface SyncLedgerEntry {
  id: string;
  userId: string;
  documentId: string | null;
  action: SyncAction;
  entityType: SyncEntityType;
  payloadHash: string | null;
  relayReceiptId: string | null;
  status: SyncLedgerStatus;
  createdAt: Date;
  syncedAt: Date | null;
}

export interface RelayPullMessage {
  receipt_id: string;
  encrypted_payload: string;
  payload_type: string;
  payload_hash: string;
  source_device_id: string;
  created_at: string;
}

export interface RelaySyncStatus {
  enabled: boolean;
  relayUrl: string | null;
  pendingPush: number;
  lastPull: string | null;
  lastPush: string | null;
}

export interface RelayConflict {
  id: string;
  documentId: string;
  localVersion: {
    updatedAt: Date;
    hash: string;
  };
  remoteVersion: {
    updatedAt: Date;
    hash: string;
    sourceDeviceId: string;
  };
  detectedAt: Date;
  resolved: boolean;
  resolution?: RelayConflictStrategy;
}
