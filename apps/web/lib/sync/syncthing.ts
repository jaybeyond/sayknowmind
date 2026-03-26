/**
 * Syncthing Integration — Device-to-Device Data Synchronization
 *
 * Manages bidirectional sync of SayknowMind data between devices
 * using Syncthing's REST API.
 */

export interface SyncthingDevice {
  deviceID: string;
  name: string;
  connected: boolean;
  lastSeen: string;
  address: string;
}

export interface SyncthingFolder {
  id: string;
  label: string;
  path: string;
  devices: string[];
  status: "idle" | "syncing" | "error";
}

export interface SyncConflict {
  path: string;
  localModified: string;
  remoteModified: string;
  localSize: number;
  remoteSize: number;
}

export interface SyncStatus {
  connected: boolean;
  devices: SyncthingDevice[];
  folders: SyncthingFolder[];
  conflicts: SyncConflict[];
}

const SYNCTHING_API = process.env.SYNCTHING_API ?? "http://localhost:8384";
const SYNCTHING_API_KEY = process.env.SYNCTHING_API_KEY ?? "";

function syncHeaders(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (SYNCTHING_API_KEY) h["X-API-Key"] = SYNCTHING_API_KEY;
  return h;
}

/**
 * Get Syncthing connection status and device list.
 */
export async function getSyncStatus(): Promise<SyncStatus> {
  try {
    const [sysRes, connRes] = await Promise.all([
      fetch(`${SYNCTHING_API}/rest/system/status`, {
        headers: syncHeaders(),
        signal: AbortSignal.timeout(5_000),
      }),
      fetch(`${SYNCTHING_API}/rest/system/connections`, {
        headers: syncHeaders(),
        signal: AbortSignal.timeout(5_000),
      }),
    ]);

    if (!sysRes.ok || !connRes.ok) {
      return { connected: false, devices: [], folders: [], conflicts: [] };
    }

    const connections = await connRes.json();
    const devices: SyncthingDevice[] = [];

    for (const [id, conn] of Object.entries(connections.connections ?? {})) {
      const c = conn as Record<string, unknown>;
      devices.push({
        deviceID: id,
        name: String(c.name ?? id.slice(0, 8)),
        connected: Boolean(c.connected),
        lastSeen: String(c.startedAt ?? ""),
        address: String(c.address ?? ""),
      });
    }

    // Get folders
    const folderRes = await fetch(`${SYNCTHING_API}/rest/system/config`, {
      headers: syncHeaders(),
      signal: AbortSignal.timeout(5_000),
    });
    const config = folderRes.ok ? await folderRes.json() : { folders: [] };
    const folders: SyncthingFolder[] = (config.folders ?? []).map((f: Record<string, unknown>) => ({
      id: String(f.id ?? ""),
      label: String(f.label ?? ""),
      path: String(f.path ?? ""),
      devices: Array.isArray(f.devices) ? f.devices.map((d: Record<string, unknown>) => String(d.deviceID ?? "")) : [],
      status: "idle" as const,
    }));

    // Get conflicts
    const conflicts = await getConflicts();

    return { connected: true, devices, folders, conflicts };
  } catch {
    return { connected: false, devices: [], folders: [], conflicts: [] };
  }
}

/**
 * Get sync conflicts that need manual resolution.
 */
export async function getConflicts(): Promise<SyncConflict[]> {
  try {
    const res = await fetch(`${SYNCTHING_API}/rest/db/need?folder=sayknowmind-data`, {
      headers: syncHeaders(),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return [];

    const data = await res.json();
    const conflicts: SyncConflict[] = [];

    for (const file of data.progress ?? []) {
      if (file.type === "file") {
        conflicts.push({
          path: file.name,
          localModified: file.localModified ?? "",
          remoteModified: file.remoteModified ?? "",
          localSize: file.localSize ?? 0,
          remoteSize: file.size ?? 0,
        });
      }
    }

    return conflicts;
  } catch {
    return [];
  }
}

/**
 * Resolve a sync conflict by choosing local or remote version.
 */
export async function resolveConflict(
  path: string,
  resolution: "keep_local" | "keep_remote",
): Promise<boolean> {
  try {
    if (resolution === "keep_remote") {
      // Revert local file to let Syncthing pull the remote version
      await fetch(`${SYNCTHING_API}/rest/db/revert?folder=sayknowmind-data`, {
        method: "POST",
        headers: syncHeaders(),
        signal: AbortSignal.timeout(5_000),
      });
    } else {
      // Override remote with local version
      await fetch(`${SYNCTHING_API}/rest/db/override?folder=sayknowmind-data`, {
        method: "POST",
        headers: syncHeaders(),
        signal: AbortSignal.timeout(5_000),
      });
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Add a new device to sync with.
 */
export async function addSyncDevice(deviceID: string, name: string): Promise<boolean> {
  try {
    // Get current config
    const configRes = await fetch(`${SYNCTHING_API}/rest/system/config`, {
      headers: syncHeaders(),
      signal: AbortSignal.timeout(5_000),
    });
    if (!configRes.ok) return false;

    const config = await configRes.json();
    config.devices = config.devices ?? [];
    config.devices.push({
      deviceID,
      name,
      addresses: ["dynamic"],
      autoAcceptFolders: true,
    });

    // Update config
    const updateRes = await fetch(`${SYNCTHING_API}/rest/system/config`, {
      method: "PUT",
      headers: syncHeaders(),
      body: JSON.stringify(config),
      signal: AbortSignal.timeout(5_000),
    });

    return updateRes.ok;
  } catch {
    return false;
  }
}
