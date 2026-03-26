import { NextRequest, NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { isPrivateMode } from "@/lib/private-mode";
import { getTailscaleStatus, discoverSayknowmindPeers } from "@/lib/sync/tailscale";
import { getSyncStatus } from "@/lib/sync/syncthing";
import { ErrorCode } from "@/lib/types";

export async function GET(request: NextRequest) {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json(
      { code: ErrorCode.AUTH_TOKEN_EXPIRED, message: "Unauthorized", timestamp: new Date().toISOString() },
      { status: 401 },
    );
  }

  const [tailscale, syncthing] = await Promise.all([
    getTailscaleStatus(),
    getSyncStatus(),
  ]);

  const peers = tailscale.connected ? await discoverSayknowmindPeers() : [];

  return NextResponse.json({
    privateMode: isPrivateMode(),
    tailscale: {
      connected: tailscale.connected,
      selfHostname: tailscale.selfHostname,
      selfIP: tailscale.selfIP,
      peerCount: tailscale.peers.length,
      sayknowmindPeers: peers,
    },
    syncthing: {
      connected: syncthing.connected,
      deviceCount: syncthing.devices.length,
      folderCount: syncthing.folders.length,
      conflictCount: syncthing.conflicts.length,
      conflicts: syncthing.conflicts,
    },
  });
}
