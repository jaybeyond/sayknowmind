/**
 * Shared HMAC-SHA256 JWT primitives for relay and collab tokens.
 *
 * Both token types are signed with RELAY_SHARED_SECRET and verified against the
 * primary secret plus the comma-separated RELAY_SHARED_SECRET_PREVIOUS secrets
 * (zero-downtime rotation: set the new value as RELAY_SHARED_SECRET, move the
 * old one into RELAY_SHARED_SECRET_PREVIOUS, drop it after the max token TTL).
 *
 * Extracted so the security-sensitive verification (constant-time, multi-secret)
 * lives in ONE place — previously it was copy-pasted in relay-token.ts and
 * collab-token.ts and could drift (CODE-REVIEW cleanup).
 */
import { createHmac } from "node:crypto";

/** Primary secret — signs new tokens. */
export const SHARED_SECRET = process.env.RELAY_SHARED_SECRET ?? "";

const PREVIOUS_SECRETS = (process.env.RELAY_SHARED_SECRET_PREVIOUS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** All secrets accepted at verification time (primary + rotation overlap). */
export const VERIFY_SECRETS = [SHARED_SECRET, ...PREVIOUS_SECRETS].filter(Boolean);

export function base64UrlEncode(data: string): string {
  return Buffer.from(data).toString("base64url");
}

export function base64UrlDecode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

export function signWith(secret: string, header: string, payload: string): string {
  return createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
}

/**
 * Constant-time check that `signature` matches `header.payload` under ANY
 * currently-valid secret. Every secret is compared without early-exit to keep
 * timing uniform regardless of which (or whether a) secret matches.
 */
export function verifySignature(
  header: string,
  payload: string,
  signature: string,
): boolean {
  let matched = false;
  for (const secret of VERIFY_SECRETS) {
    const expectedSig = signWith(secret, header, payload);
    if (signature.length !== expectedSig.length) continue;
    let mismatch = 0;
    for (let i = 0; i < signature.length; i++) {
      mismatch |= signature.charCodeAt(i) ^ expectedSig.charCodeAt(i);
    }
    if (mismatch === 0) matched = true;
  }
  return matched;
}
