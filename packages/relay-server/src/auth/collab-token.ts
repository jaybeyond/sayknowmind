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
import { VERIFY_SECRETS, base64UrlDecode, verifySignature } from "./hmac";

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

export function verifyCollabToken(token: string): CollabTokenPayload | null {
  if (VERIFY_SECRETS.length === 0) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;

  if (!verifySignature(header, payload, signature)) return null;

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
