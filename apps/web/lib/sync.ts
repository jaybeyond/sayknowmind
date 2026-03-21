/**
 * Tailscale + Syncthing Integration for Private Mode Device Sync
 *
 * - Tailscale: Secure VPN mesh for accessing SayknowMind from any device
 * - Syncthing: File sync between devices for raw documents
 * - Conflict detection and resolution
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyncDevice {
  id: string;
  name: string;
  address: string;
  lastSeen: Date;
  connected: boolean;
}

export type ConflictResolution = "keep_local" | "keep_remote" | "keep_both";

export interface SyncConflict {
  id: string;
  filePath: string;
  localVersion: {
    modifiedAt: Date;
    size: number;
    hash: string;
  };
  remoteVersion: {
    modifiedAt: Date;
    size: number;
    hash: string;
    deviceName: string;
  };
  detectedAt: Date;
  resolved: boolean;
  resolution?: ConflictResolution;
}

export interface SyncStatus {
  tailscaleConnected: boolean;
  tailscaleIp?: string;
  syncthingRunning: boolean;
  devices: SyncDevice[];
  pendingConflicts: number;
  lastSync?: Date;
}

// ---------------------------------------------------------------------------
// Tailscale Integration
// ---------------------------------------------------------------------------

const TAILSCALE_API = "http://localhost:41112"; // Tailscale local API

/**
 * Check if Tailscale is running and get connection status.
 */
export async function getTailscaleStatus(): Promise<{
  connected: boolean;
  ip?: string;
  hostname?: string;
}> {
  try {
    const response = await fetch(`${TAILSCALE_API}/localapi/v0/status`, {
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) return { connected: false };
    const data = await response.json();
    return {
      connected: data.BackendState === "Running",
      ip: data.TailscaleIPs?.[0],
      hostname: data.Self?.HostName,
    };
  } catch {
    return { connected: false };
  }
}

/**
 * Get list of peers connected via Tailscale.
 */
export async function getTailscalePeers(): Promise<SyncDevice[]> {
  try {
    const response = await fetch(`${TAILSCALE_API}/localapi/v0/status`);
    if (!response.ok) return [];
    const data = await response.json();
    const peers = data.Peer ?? {};
    return Object.values(peers).map((peer: unknown) => {
      const p = peer as { ID: string; HostName: string; TailscaleIPs: string[]; LastSeen: string; Online: boolean };
      return {
        id: p.ID,
        name: p.HostName,
        address: p.TailscaleIPs?.[0] ?? "",
        lastSeen: new Date(p.LastSeen),
        connected: p.Online,
      };
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Syncthing Integration
// ---------------------------------------------------------------------------

const SYNCTHING_API = process.env.SYNCTHING_URL ?? "http://localhost:8384";
const SYNCTHING_API_KEY = process.env.SYNCTHING_API_KEY ?? "";

function syncthingHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (SYNCTHING_API_KEY) h["X-API-Key"] = SYNCTHING_API_KEY;
  return h;
}

/**
 * Check if Syncthing is running.
 */
export async function isSyncthingRunning(): Promise<boolean> {
  try {
    const response = await fetch(`${SYNCTHING_API}/rest/system/ping`, {
      headers: syncthingHeaders(),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get Syncthing connected devices.
 */
export async function getSyncthingDevices(): Promise<SyncDevice[]> {
  try {
    const response = await fetch(`${SYNCTHING_API}/rest/system/connections`, {
      headers: syncthingHeaders(),
    });
    if (!response.ok) return [];
    const data = await response.json();
    const connections = data.connections ?? {};
    return Object.entries(connections).map(([id, conn]) => {
      const c = conn as { connected: boolean; address: string };
      return {
        id,
        name: id.slice(0, 8),
        address: c.address,
        lastSeen: new Date(),
        connected: c.connected,
      };
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Conflict Detection & Resolution
// ---------------------------------------------------------------------------

// In-memory conflict store (use DB in production)
const conflicts = new Map<string, SyncConflict>();

/**
 * Detect and register a sync conflict.
 */
export function detectConflict(
  filePath: string,
  localHash: string,
  localModified: Date,
  localSize: number,
  remoteHash: string,
  remoteModified: Date,
  remoteSize: number,
  remoteDeviceName: string,
): SyncConflict {
  if (localHash === remoteHash) {
    // No conflict if hashes match
    throw new Error("No conflict: files are identical");
  }

  const conflict: SyncConflict = {
    id: `conflict-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    filePath,
    localVersion: { modifiedAt: localModified, size: localSize, hash: localHash },
    remoteVersion: {
      modifiedAt: remoteModified,
      size: remoteSize,
      hash: remoteHash,
      deviceName: remoteDeviceName,
    },
    detectedAt: new Date(),
    resolved: false,
  };

  conflicts.set(conflict.id, conflict);
  return conflict;
}

/**
 * Get all unresolved conflicts.
 */
export function getPendingConflicts(): SyncConflict[] {
  return [...conflicts.values()].filter((c) => !c.resolved);
}

/**
 * Resolve a conflict with the chosen strategy.
 */
export function resolveConflict(
  conflictId: string,
  resolution: ConflictResolution,
): SyncConflict {
  const conflict = conflicts.get(conflictId);
  if (!conflict) throw new Error("Conflict not found");
  if (conflict.resolved) throw new Error("Conflict already resolved");

  conflict.resolved = true;
  conflict.resolution = resolution;
  return conflict;
}

/**
 * Clear all resolved conflicts.
 */
export function clearResolvedConflicts(): number {
  let cleared = 0;
  for (const [id, conflict] of conflicts) {
    if (conflict.resolved) {
      conflicts.delete(id);
      cleared++;
    }
  }
  return cleared;
}

// ---------------------------------------------------------------------------
// Combined Sync Status
// ---------------------------------------------------------------------------

/**
 * Get combined sync status from Tailscale and Syncthing.
 */
export async function getSyncStatus(): Promise<SyncStatus> {
  const [tsStatus, stRunning, stDevices] = await Promise.all([
    getTailscaleStatus(),
    isSyncthingRunning(),
    getSyncthingDevices(),
  ]);

  return {
    tailscaleConnected: tsStatus.connected,
    tailscaleIp: tsStatus.ip,
    syncthingRunning: stRunning,
    devices: stDevices,
    pendingConflicts: getPendingConflicts().length,
    lastSync: new Date(),
  };
}
