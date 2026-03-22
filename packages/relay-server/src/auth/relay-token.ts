/**
 * Relay token verification — HMAC-SHA256 signed JWT.
 * The relay never accesses the local user DB.
 * It only verifies the signature using RELAY_SHARED_SECRET.
 */
import { createHmac } from "node:crypto";

export interface RelayTokenPayload {
  sub: string; // user ID
  iss: string; // "sayknowmind-local"
  aud: string; // "sayknowmind-relay"
  iat: number;
  exp: number;
  deviceId: string;
}

const SHARED_SECRET = process.env.RELAY_SHARED_SECRET ?? "";

function base64UrlEncode(data: string): string {
  return Buffer.from(data).toString("base64url");
}

function base64UrlDecode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function sign(header: string, payload: string): string {
  return createHmac("sha256", SHARED_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
}

export function issueRelayToken(
  userId: string,
  deviceId: string,
  expiresInSeconds = 7 * 24 * 60 * 60,
): string {
  if (!SHARED_SECRET) throw new Error("RELAY_SHARED_SECRET is not configured");

  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: userId,
      iss: "sayknowmind-local",
      aud: "sayknowmind-relay",
      iat: now,
      exp: now + expiresInSeconds,
      deviceId,
    } satisfies RelayTokenPayload),
  );

  const signature = sign(header, payload);
  return `${header}.${payload}.${signature}`;
}

export function verifyRelayToken(token: string): RelayTokenPayload | null {
  if (!SHARED_SECRET) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const expectedSig = sign(header, payload);

  // Constant-time comparison
  if (signature.length !== expectedSig.length) return null;
  let mismatch = 0;
  for (let i = 0; i < signature.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  }
  if (mismatch !== 0) return null;

  try {
    const decoded = JSON.parse(base64UrlDecode(payload)) as RelayTokenPayload;

    if (decoded.iss !== "sayknowmind-local") return null;
    if (decoded.aud !== "sayknowmind-relay") return null;
    if (decoded.exp < Math.floor(Date.now() / 1000)) return null;

    return decoded;
  } catch {
    return null;
  }
}
