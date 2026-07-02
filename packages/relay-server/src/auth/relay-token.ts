/**
 * Relay token verification — HMAC-SHA256 signed JWT.
 * The relay never accesses the local user DB.
 * It only verifies the signature using RELAY_SHARED_SECRET.
 */
import {
  SHARED_SECRET,
  VERIFY_SECRETS,
  base64UrlEncode,
  base64UrlDecode,
  signWith,
  verifySignature,
} from "./hmac";

export interface RelayTokenPayload {
  sub: string; // user ID
  iss: string; // "sayknowmind-local"
  aud: string; // "sayknowmind-relay"
  iat: number;
  exp: number;
  deviceId: string;
}

function sign(header: string, payload: string): string {
  return signWith(SHARED_SECRET, header, payload);
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
  if (VERIFY_SECRETS.length === 0) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;

  if (!verifySignature(header, payload, signature)) return null;

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
