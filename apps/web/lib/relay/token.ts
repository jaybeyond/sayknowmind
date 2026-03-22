/**
 * Relay token issuance — local server side.
 * Issues HMAC-SHA256 signed JWTs for relay authentication.
 * Shares the same verification logic as packages/relay-server/src/auth/relay-token.ts.
 */
import { createHmac, randomUUID } from "node:crypto";

export interface RelayTokenPayload {
  sub: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  deviceId: string;
}

const SHARED_SECRET = process.env.RELAY_SHARED_SECRET ?? "";

// Persist device ID across restarts via env or generate once
let cachedDeviceId: string | null = null;

export function getDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;
  cachedDeviceId = process.env.DEVICE_ID ?? randomUUID();
  return cachedDeviceId;
}

function base64UrlEncode(data: string): string {
  return Buffer.from(data).toString("base64url");
}

function sign(header: string, payload: string): string {
  return createHmac("sha256", SHARED_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
}

/**
 * Issue a relay token for a user. Called when user enables relay sync.
 */
export function issueRelayToken(
  userId: string,
  expiresInSeconds = 7 * 24 * 60 * 60,
): string {
  if (!SHARED_SECRET) {
    throw new Error("RELAY_SHARED_SECRET is not configured");
  }

  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: userId,
      iss: "sayknowmind-local",
      aud: "sayknowmind-relay",
      iat: now,
      exp: now + expiresInSeconds,
      deviceId: getDeviceId(),
    } satisfies RelayTokenPayload),
  );

  const signature = sign(header, payload);
  return `${header}.${payload}.${signature}`;
}

/**
 * Check if relay sync is configured (both URL and secret present).
 */
export function isRelayConfigured(): boolean {
  return !!(process.env.RELAY_URL && SHARED_SECRET);
}

/**
 * Get the relay server URL.
 */
export function getRelayUrl(): string | null {
  return process.env.RELAY_URL ?? null;
}
