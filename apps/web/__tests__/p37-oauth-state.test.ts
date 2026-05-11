/**
 * Property 37: Cloud-connector OAuth state must be tamper-evident.
 *
 * The state parameter binds a freshly issued OAuth flow to a specific
 * userId/provider. If an attacker can forge or alter it, they can trick
 * the callback handler into binding their tokens to someone else's
 * account. These tests verify the HMAC signing keeps that closed.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

const ORIGINAL_SECRET = process.env.BETTER_AUTH_SECRET;

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET = "test-secret-do-not-use-in-prod-please";
});

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.BETTER_AUTH_SECRET;
  else process.env.BETTER_AUTH_SECRET = ORIGINAL_SECRET;
});

// Import lazily so the env var above is set before module evaluation.
let signState: typeof import("@/lib/integrations/connectors/_oauth-state").signState;
let verifyState: typeof import("@/lib/integrations/connectors/_oauth-state").verifyState;

beforeAll(async () => {
  const mod = await import("@/lib/integrations/connectors/_oauth-state");
  signState = mod.signState;
  verifyState = mod.verifyState;
});

describe("OAuth state signing — round-trip", () => {
  it("verify(sign(payload)) returns the original userId/provider", () => {
    const state = signState({ userId: "user-abc", provider: "google-drive" });
    const verified = verifyState(state);
    expect(verified).not.toBeNull();
    expect(verified!.userId).toBe("user-abc");
    expect(verified!.provider).toBe("google-drive");
    expect(typeof verified!.nonce).toBe("string");
    expect(verified!.nonce.length).toBeGreaterThan(0);
    expect(typeof verified!.issuedAt).toBe("number");
  });

  it("two calls with the same input produce different state strings (random nonce)", () => {
    const a = signState({ userId: "u", provider: "gmail" });
    const b = signState({ userId: "u", provider: "gmail" });
    expect(a).not.toBe(b);
  });
});

describe("OAuth state signing — tamper resistance", () => {
  it("flipping any byte in the signature is rejected", () => {
    const state = signState({ userId: "victim", provider: "google-drive" });
    const dot = state.indexOf(".");
    const body = state.slice(0, dot);
    const sig = state.slice(dot + 1);
    // Decode the signature, XOR the first byte, and re-encode. We can't just
    // flip the last base64 char because base64url's trailing char often only
    // encodes a partial byte, so an A↔B swap can decode to the same bytes.
    const sigBuf = Buffer.from(sig.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    sigBuf[0] = sigBuf[0] ^ 0xff;
    const tamperedSig = sigBuf.toString("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(verifyState(`${body}.${tamperedSig}`)).toBeNull();
  });

  it("rewriting the body without a fresh signature is rejected", () => {
    const state = signState({ userId: "victim", provider: "google-drive" });
    const dot = state.indexOf(".");
    const sig = state.slice(dot + 1);

    // Forge a new body that swaps the userId, keeping the original signature.
    const forgedPayload = JSON.stringify({
      userId: "attacker",
      provider: "google-drive",
      nonce: "x",
      issuedAt: Date.now(),
    });
    const forgedBody = Buffer.from(forgedPayload, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const tampered = `${forgedBody}.${sig}`;
    expect(verifyState(tampered)).toBeNull();
  });

  it("malformed strings (no dot, empty, junk) return null instead of throwing", () => {
    expect(verifyState("")).toBeNull();
    expect(verifyState("nodothere")).toBeNull();
    expect(verifyState(".")).toBeNull();
    expect(verifyState("a.b.c.d.e")).toBeNull();
    expect(verifyState("not_base64_!@#.also_not")).toBeNull();
  });

  it("a state signed with a different secret does not validate under the current secret", async () => {
    // Forge a state where the body is well-formed but the HMAC was computed
    // with a different secret. verifyState must reject it.
    const { createHmac } = await import("node:crypto");
    const wrongSecret = "different-secret-value-completely";
    const payload = JSON.stringify({
      userId: "victim",
      provider: "google-drive",
      nonce: "n",
      issuedAt: Date.now(),
    });
    const body = Buffer.from(payload, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const wrongSig = createHmac("sha256", wrongSecret)
      .update(body)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(verifyState(`${body}.${wrongSig}`)).toBeNull();
  });
});

describe("OAuth state signing — TTL expiry", () => {
  // The module-internal TTL is 10 minutes. We can't change it from outside,
  // so we forge a payload with an old issuedAt and confirm verifyState
  // rejects it. This requires us to sign manually using the same secret.
  it("a state older than 10 minutes is rejected", async () => {
    const { createHmac } = await import("node:crypto");
    const secret = process.env.BETTER_AUTH_SECRET!;
    const oldPayload = JSON.stringify({
      userId: "u",
      provider: "google-drive",
      nonce: "n",
      issuedAt: Date.now() - 11 * 60 * 1000, // 11 minutes ago
    });
    const body = Buffer.from(oldPayload, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const sig = createHmac("sha256", secret)
      .update(body)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const expired = `${body}.${sig}`;
    expect(verifyState(expired)).toBeNull();
  });

  it("a state issued just now is accepted", () => {
    const state = signState({ userId: "u", provider: "google-drive" });
    expect(verifyState(state)).not.toBeNull();
  });
});
