/**
 * POST /api/sync/relay/enable — Enable relay sync and get a relay token.
 */
import { NextResponse } from "next/server";
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
import { issueRelayToken, isRelayConfigured, getRelayUrl, getDeviceId } from "@/lib/relay/token";

export async function POST() {
  const userId = await getUserIdFromRequest();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isRelayConfigured()) {
    return NextResponse.json(
      { error: "Relay sync is not configured. Set RELAY_URL and RELAY_SHARED_SECRET." },
      { status: 503 },
    );
  }

  const relayToken = issueRelayToken(userId);
  const relayUrl = getRelayUrl();
  const deviceId = getDeviceId();

  return NextResponse.json({
    relay_token: relayToken,
    relay_url: relayUrl,
    device_id: deviceId,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
}
