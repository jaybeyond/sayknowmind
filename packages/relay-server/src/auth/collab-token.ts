/**
 * Collab token verification — HMAC-SHA256 signed JWT, doc-scoped.
 *
 * The browser holds a better-auth session cookie the WS server can't read, so
 * the web app mints a short-lived, document-scoped token (see
 * apps/web/lib/collab/token.ts) and the client passes it to Hocuspocus. We
 * verify the signature with the same RELAY_SHARED_SECRET, then enforce that the
 * token's `doc` matches the room being joined.
 *
 * Distinct `aud` ("sayknowmind-collab") keeps these tokens from being
 * interchangeable with relay sync tokens ("sayknowmind-relay").
 */
import { createHmac } from "node:crypto";

export interface CollabTokenPayload {
  sub: string; // user id
  iss: string; // "sayknowmind-local"
  aud: string; // "sayknowmind-collab"
  iat: number;
  exp: number;
  doc: string; // document id this token authorizes
  org: string; // active organization id
  canWrite: boolean; // false => read-only collaborator
}

const SHARED_SECRET = process.env.RELAY_SHARED_SECRET ?? "";

function base64UrlDecode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf-8");
}

function sign(header: string, payload: string): string {
  return createHmac("sha256", SHARED_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
}

export function verifyCollabToken(token: string): CollabTokenPayload | null {
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
    const decoded = JSON.parse(base64UrlDecode(payload)) as CollabTokenPayload;

    if (decoded.iss !== "sayknowmind-local") return null;
    if (decoded.aud !== "sayknowmind-collab") return null;
    if (decoded.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof decoded.doc !== "string" || decoded.doc.length === 0) return null;

    return decoded;
  } catch {
    return null;
  }
}
