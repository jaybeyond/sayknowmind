/**
 * Tailscale Integration — Secure Device Discovery & Networking
 *
 * Provides peer discovery and secure connections between SayknowMind
 * instances on the same Tailscale network (tailnet).
 */

export interface TailscalePeer {
  id: string;
  hostname: string;
  ipv4: string;
  ipv6?: string;
  online: boolean;
  os: string;
  lastSeen: string;
  sayknowmindPort?: number;
}

export interface TailscaleStatus {
  connected: boolean;
  selfHostname: string;
  selfIP: string;
  tailnetName: string;
  peers: TailscalePeer[];
}

const TAILSCALE_SOCKET = process.env.TAILSCALE_SOCKET ?? "/var/run/tailscale/tailscaled.sock";
const TAILSCALE_API = process.env.TAILSCALE_API ?? "http://localhost:41112";

/**
 * Get Tailscale network status via local API.
 */
export async function getTailscaleStatus(): Promise<TailscaleStatus> {
  try {
    const res = await fetch(`${TAILSCALE_API}/localapi/v0/status`, {
      signal: AbortSignal.timeout(5_000),
    });

    if (!res.ok) {
      return { connected: false, selfHostname: "", selfIP: "", tailnetName: "", peers: [] };
    }

    const data = await res.json();
    const self = data.Self ?? {};
    const peers: TailscalePeer[] = [];

    for (const [id, peer] of Object.entries(data.Peer ?? {})) {
      const p = peer as Record<string, unknown>;
      peers.push({
        id,
        hostname: String(p.HostName ?? ""),
        ipv4: Array.isArray(p.TailscaleIPs) ? String(p.TailscaleIPs[0] ?? "") : "",
        ipv6: Array.isArray(p.TailscaleIPs) && p.TailscaleIPs.length > 1 ? String(p.TailscaleIPs[1]) : undefined,
        online: Boolean(p.Online),
        os: String(p.OS ?? ""),
        lastSeen: String(p.LastSeen ?? ""),
      });
    }

    return {
      connected: true,
      selfHostname: String(self.HostName ?? ""),
      selfIP: Array.isArray(self.TailscaleIPs) ? String(self.TailscaleIPs[0] ?? "") : "",
      tailnetName: String(data.MagicDNSSuffix ?? ""),
      peers,
    };
  } catch {
    return { connected: false, selfHostname: "", selfIP: "", tailnetName: "", peers: [] };
  }
}

/**
 * Discover SayknowMind instances on the Tailscale network.
 * Probes each peer's health endpoint to find active instances.
 */
export async function discoverSayknowmindPeers(): Promise<TailscalePeer[]> {
  const status = await getTailscaleStatus();
  if (!status.connected) return [];

  const onlinePeers = status.peers.filter((p) => p.online);
  const discovered: TailscalePeer[] = [];

  const probes = onlinePeers.map(async (peer) => {
    // Try common SayknowMind ports
    for (const port of [3000, 8080]) {
      try {
        const res = await fetch(`http://${peer.ipv4}:${port}/api/health`, {
          signal: AbortSignal.timeout(3_000),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.service === "sayknowmind" || data.status === "ok") {
            discovered.push({ ...peer, sayknowmindPort: port });
            return;
          }
        }
      } catch { /* peer not running SayknowMind on this port */ }
    }
  });

  await Promise.allSettled(probes);
  return discovered;
}
