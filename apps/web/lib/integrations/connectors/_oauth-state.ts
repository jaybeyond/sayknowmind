/**
 * Signed OAuth state token.
 *
 * The OAuth state parameter must be tamper-evident so an attacker can't
 * trick the callback handler into binding their tokens to someone else's
 * userId. We sign the state with the server-side BETTER_AUTH_SECRET (HMAC).
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ConnectorId } from "./_interface";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface StatePayload {
  userId: string;
  provider: ConnectorId;
  nonce: string;
  issuedAt: number;
}

function getSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is required to sign OAuth state");
  }
  return secret;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function signState(payload: Omit<StatePayload, "issuedAt" | "nonce"> & { nonce?: string }): string {
  const full: StatePayload = {
    userId: payload.userId,
    provider: payload.provider,
    nonce: payload.nonce ?? b64url(Buffer.from(crypto.getRandomValues(new Uint8Array(16)))),
    issuedAt: Date.now(),
  };
  const json = JSON.stringify(full);
  const body = b64url(Buffer.from(json, "utf8"));
  const sig = b64url(createHmac("sha256", getSecret()).update(body).digest());
  return `${body}.${sig}`;
}

export function verifyState(state: string): StatePayload | null {
  const dot = state.indexOf(".");
  if (dot < 0) return null;
  const body = state.slice(0, dot);
  const sig = state.slice(dot + 1);

  const expected = createHmac("sha256", getSecret()).update(body).digest();
  const actual = fromB64url(sig);
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  let payload: StatePayload;
  try {
    payload = JSON.parse(fromB64url(body).toString("utf8"));
  } catch {
    return null;
  }

  if (Date.now() - payload.issuedAt > STATE_TTL_MS) return null;
  return payload;
}
