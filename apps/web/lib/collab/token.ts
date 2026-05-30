/**
 * Collab token issuance — server side.
 *
 * Mints short-lived, document-scoped HMAC-SHA256 tokens the browser hands to
 * the Hocuspocus WS server (packages/relay-server). The token encodes WHICH
 * document it opens and whether the holder may write, so the WS server can
 * authorize without reading the better-auth session. Verified by
 * packages/relay-server/src/auth/collab-token.ts with the same secret.
 *
 * Reuses RELAY_SHARED_SECRET (already shared between web and relay) but a
 * distinct `aud` keeps collab tokens from doubling as relay sync tokens.
 */
import { createHmac } from "node:crypto";

export interface CollabTokenPayload {
  sub: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  doc: string;
  org: string;
  canWrite: boolean;
}

const SHARED_SECRET = process.env.RELAY_SHARED_SECRET ?? "";

function base64UrlEncode(data: string): string {
  return Buffer.from(data).toString("base64url");
}

function sign(header: string, payload: string): string {
  return createHmac("sha256", SHARED_SECRET).update(`${header}.${payload}`).digest("base64url");
}

/**
 * Issue a collab token for one document. Short-lived: it only needs to survive
 * the WS handshake — Hocuspocus checks it once at connect time.
 */
export function issueCollabToken(
  userId: string,
  organizationId: string,
  documentId: string,
  canWrite: boolean,
  expiresInSeconds = 5 * 60,
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
      aud: "sayknowmind-collab",
      iat: now,
      exp: now + expiresInSeconds,
      doc: documentId,
      org: organizationId,
      canWrite,
    } satisfies CollabTokenPayload),
  );

  const signature = sign(header, payload);
  return `${header}.${payload}.${signature}`;
}

/** Public WS URL the browser connects to (e.g. ws://localhost:3200/collab). */
export function getCollabWsUrl(): string | null {
  return process.env.NEXT_PUBLIC_COLLAB_WS_URL ?? null;
}

/** Collab is available only when both the WS URL and the shared secret exist. */
export function isCollabConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_COLLAB_WS_URL && SHARED_SECRET);
}
