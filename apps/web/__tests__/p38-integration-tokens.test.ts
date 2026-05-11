/**
 * Property 38: Integration tokens are encrypted at rest and isolated per user.
 *
 * `_token-store` is the only path through which OAuth tokens reach the
 * database. These tests confirm that:
 *   1. tokens round-trip through encrypt → store → decrypt unchanged,
 *   2. ciphertext on disk is never the plaintext,
 *   3. each write uses a fresh IV so identical plaintexts produce
 *      different rows (no determinism a passive observer could exploit),
 *   4. lookups are scoped by (userId, provider, accountId) — a user can
 *      never read another user's row.
 *
 * The Postgres pool is replaced with an in-memory store so the test runs
 * without a database. All other behaviour (crypto, query shape) is real.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Env: encryption key must be present before the module under test loads.
// ---------------------------------------------------------------------------
const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;

beforeAll(() => {
  // 32 bytes hex (the documented form)
  process.env.ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
});

// ---------------------------------------------------------------------------
// In-memory pool that stands in for Postgres. We model just the queries the
// token store actually issues, asserted by their leading SQL keyword.
// ---------------------------------------------------------------------------

interface Row {
  user_id: string;
  provider: string;
  account_id: string;
  account_email: string | null;
  account_label: string | null;
  scope: string | null;
  access_token: string;
  access_iv: string;
  access_tag: string;
  refresh_token: string | null;
  refresh_iv: string | null;
  refresh_tag: string | null;
  expires_at: Date | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

const rows: Row[] = [];

function findIdx(userId: string, provider: string, accountId: string): number {
  return rows.findIndex(
    (r) => r.user_id === userId && r.provider === provider && r.account_id === accountId,
  );
}

const fakePool = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    const trimmed = sql.trim().toUpperCase();

    if (trimmed.startsWith("INSERT INTO USER_INTEGRATION_TOKENS")) {
      const [
        userId, provider, accountId, accountEmail, accountLabel, scope,
        accessCt, accessIv, accessTag,
        refreshCt, refreshIv, refreshTag,
        expiresAt, metadata,
      ] = params as [
        string, string, string, string | null, string | null, string | null,
        string, string, string,
        string | null, string | null, string | null,
        Date | null, Record<string, unknown>,
      ];
      const idx = findIdx(userId, provider, accountId);
      if (idx >= 0) {
        const existing = rows[idx];
        rows[idx] = {
          ...existing,
          account_email: accountEmail,
          account_label: accountLabel,
          scope,
          access_token: accessCt,
          access_iv: accessIv,
          access_tag: accessTag,
          // Preserve old refresh on null (matches ON CONFLICT clause)
          refresh_token: refreshCt ?? existing.refresh_token,
          refresh_iv: refreshIv ?? existing.refresh_iv,
          refresh_tag: refreshTag ?? existing.refresh_tag,
          expires_at: expiresAt,
          metadata: { ...existing.metadata, ...metadata },
          updated_at: new Date(),
        };
      } else {
        const now = new Date();
        rows.push({
          user_id: userId, provider, account_id: accountId,
          account_email: accountEmail, account_label: accountLabel, scope,
          access_token: accessCt, access_iv: accessIv, access_tag: accessTag,
          refresh_token: refreshCt, refresh_iv: refreshIv, refresh_tag: refreshTag,
          expires_at: expiresAt,
          metadata: metadata ?? {},
          created_at: now, updated_at: now,
        });
      }
      return { rows: [], rowCount: 1 };
    }

    if (trimmed.startsWith("SELECT USER_ID, PROVIDER, ACCOUNT_ID")) {
      const [userId, provider, accountId] = params as [string, string, string];
      const idx = findIdx(userId, provider, accountId);
      return { rows: idx >= 0 ? [rows[idx]] : [], rowCount: idx >= 0 ? 1 : 0 };
    }

    if (trimmed.startsWith("SELECT ACCOUNT_ID")) {
      const [userId, provider] = params as [string, string];
      const matches = rows
        .filter((r) => r.user_id === userId && r.provider === provider)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      return { rows: matches, rowCount: matches.length };
    }

    if (trimmed.startsWith("DELETE FROM USER_INTEGRATION_TOKENS")) {
      const [userId, provider, accountId] = params as [string, string, string];
      const idx = findIdx(userId, provider, accountId);
      if (idx >= 0) rows.splice(idx, 1);
      return { rows: [], rowCount: idx >= 0 ? 1 : 0 };
    }

    if (trimmed.startsWith("UPDATE USER_INTEGRATION_TOKENS")) {
      // Two shapes: with refresh, and without. Both end in WHERE user_id=$1 AND provider=$2 AND account_id=$3.
      // Param order: ...crypto fields..., expiresAt at the end, then user/provider/account at positions 1-3.
      const userId = params[0] as string;
      const provider = params[1] as string;
      const accountId = params[2] as string;
      const idx = findIdx(userId, provider, accountId);
      if (idx < 0) return { rows: [], rowCount: 0 };

      const r = rows[idx];
      // Slot 4..6 = access ct/iv/tag
      r.access_token = params[3] as string;
      r.access_iv = params[4] as string;
      r.access_tag = params[5] as string;
      if (params.length === 10) {
        // refresh shape
        r.refresh_token = params[6] as string;
        r.refresh_iv = params[7] as string;
        r.refresh_tag = params[8] as string;
        r.expires_at = (params[9] ?? null) as Date | null;
      } else {
        r.expires_at = (params[6] ?? null) as Date | null;
      }
      r.updated_at = new Date();
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unhandled query in fake pool: ${sql.slice(0, 80)}`);
  }),
};

vi.mock("@/lib/db", () => ({ pool: fakePool }));

// ---------------------------------------------------------------------------
// Lazy-load the module under test so the mock + env are in place.
// ---------------------------------------------------------------------------

let upsertToken: typeof import("@/lib/integrations/connectors/_token-store").upsertToken;
let getToken: typeof import("@/lib/integrations/connectors/_token-store").getToken;
let listAccounts: typeof import("@/lib/integrations/connectors/_token-store").listAccounts;
let deleteToken: typeof import("@/lib/integrations/connectors/_token-store").deleteToken;
let refreshStoredToken: typeof import("@/lib/integrations/connectors/_token-store").refreshStoredToken;

beforeAll(async () => {
  const mod = await import("@/lib/integrations/connectors/_token-store");
  upsertToken = mod.upsertToken;
  getToken = mod.getToken;
  listAccounts = mod.listAccounts;
  deleteToken = mod.deleteToken;
  refreshStoredToken = mod.refreshStoredToken;
});

beforeEach(() => {
  rows.length = 0;
  fakePool.query.mockClear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Token store — encryption round-trip", () => {
  it("upsert + get returns the same access/refresh token plaintext", async () => {
    const accessToken = "ya29.a0AfH6.access-token-with-dots-and-stuff";
    const refreshToken = "1//0gRefresh-Token-With-MoreEntropy-XYZ123";

    await upsertToken({
      userId: "user-1",
      provider: "google-drive",
      accountId: "google-sub-12345",
      accountEmail: "alice@example.com",
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const back = await getToken({
      userId: "user-1",
      provider: "google-drive",
      accountId: "google-sub-12345",
    });
    expect(back).not.toBeNull();
    expect(back!.accessToken).toBe(accessToken);
    expect(back!.refreshToken).toBe(refreshToken);
    expect(back!.accountEmail).toBe("alice@example.com");
  });

  it("ciphertext stored on disk does not equal the plaintext", async () => {
    const plaintext = "ya29.PLAINTEXT-MUST-NOT-LEAK";
    await upsertToken({
      userId: "u", provider: "google-drive", accountId: "acc",
      accessToken: plaintext,
    });
    const stored = rows[0];
    expect(stored.access_token).not.toBe(plaintext);
    expect(stored.access_token.length).toBeGreaterThan(0);
    // Base64-decoded ciphertext should also not contain the plaintext bytes.
    const decoded = Buffer.from(stored.access_token, "base64").toString("binary");
    expect(decoded.includes(plaintext)).toBe(false);
  });

  it("two writes of the same plaintext produce different ciphertext (fresh IV)", async () => {
    const plaintext = "same-token-twice";
    await upsertToken({
      userId: "u1", provider: "google-drive", accountId: "a1",
      accessToken: plaintext,
    });
    await upsertToken({
      userId: "u2", provider: "google-drive", accountId: "a2",
      accessToken: plaintext,
    });
    const [a, b] = rows;
    expect(a.access_token).not.toBe(b.access_token);
    expect(a.access_iv).not.toBe(b.access_iv);
  });

  it("refresh token field can be null and round-trips as undefined", async () => {
    await upsertToken({
      userId: "u", provider: "gmail", accountId: "x",
      accessToken: "only-access",
    });
    const back = await getToken({ userId: "u", provider: "gmail", accountId: "x" });
    expect(back).not.toBeNull();
    expect(back!.accessToken).toBe("only-access");
    expect(back!.refreshToken).toBeUndefined();
  });
});

describe("Token store — per-user isolation", () => {
  it("a lookup with a different userId never sees another user's token", async () => {
    await upsertToken({
      userId: "alice", provider: "google-drive", accountId: "shared-acc-id",
      accessToken: "alice-secret",
    });
    await upsertToken({
      userId: "bob", provider: "google-drive", accountId: "shared-acc-id",
      accessToken: "bob-secret",
    });

    const aliceView = await getToken({
      userId: "alice", provider: "google-drive", accountId: "shared-acc-id",
    });
    const bobView = await getToken({
      userId: "bob", provider: "google-drive", accountId: "shared-acc-id",
    });
    expect(aliceView!.accessToken).toBe("alice-secret");
    expect(bobView!.accessToken).toBe("bob-secret");

    // Mallory cannot read anything
    const mallory = await getToken({
      userId: "mallory", provider: "google-drive", accountId: "shared-acc-id",
    });
    expect(mallory).toBeNull();
  });

  it("listAccounts only returns rows for the requested userId", async () => {
    await upsertToken({
      userId: "alice", provider: "google-drive", accountId: "a1",
      accessToken: "t",
    });
    await upsertToken({
      userId: "alice", provider: "google-drive", accountId: "a2",
      accessToken: "t",
    });
    await upsertToken({
      userId: "bob", provider: "google-drive", accountId: "b1",
      accessToken: "t",
    });

    const aliceList = await listAccounts({ userId: "alice", provider: "google-drive" });
    expect(aliceList).toHaveLength(2);
    expect(aliceList.map((a) => a.accountId).sort()).toEqual(["a1", "a2"]);

    const bobList = await listAccounts({ userId: "bob", provider: "google-drive" });
    expect(bobList).toHaveLength(1);
    expect(bobList[0].accountId).toBe("b1");
  });
});

describe("Token store — refresh and delete", () => {
  it("refreshStoredToken updates the access token without losing the refresh token", async () => {
    await upsertToken({
      userId: "u", provider: "google-drive", accountId: "a",
      accessToken: "old-access",
      refreshToken: "long-lived-refresh",
      expiresAt: new Date(Date.now() + 1000),
    });

    await refreshStoredToken({
      userId: "u", provider: "google-drive", accountId: "a",
      newAccessToken: "new-access",
      // No newRefreshToken -> Google didn't rotate
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const back = await getToken({ userId: "u", provider: "google-drive", accountId: "a" });
    expect(back!.accessToken).toBe("new-access");
    expect(back!.refreshToken).toBe("long-lived-refresh");
  });

  it("refreshStoredToken can also rotate the refresh token", async () => {
    await upsertToken({
      userId: "u", provider: "google-drive", accountId: "a",
      accessToken: "old-access", refreshToken: "old-refresh",
    });
    await refreshStoredToken({
      userId: "u", provider: "google-drive", accountId: "a",
      newAccessToken: "new-access", newRefreshToken: "new-refresh",
    });
    const back = await getToken({ userId: "u", provider: "google-drive", accountId: "a" });
    expect(back!.accessToken).toBe("new-access");
    expect(back!.refreshToken).toBe("new-refresh");
  });

  it("deleteToken removes only the matching row", async () => {
    await upsertToken({
      userId: "u", provider: "google-drive", accountId: "keep",
      accessToken: "k",
    });
    await upsertToken({
      userId: "u", provider: "google-drive", accountId: "drop",
      accessToken: "d",
    });
    await deleteToken({ userId: "u", provider: "google-drive", accountId: "drop" });

    expect(await getToken({ userId: "u", provider: "google-drive", accountId: "drop" })).toBeNull();
    expect(await getToken({ userId: "u", provider: "google-drive", accountId: "keep" })).not.toBeNull();
  });
});

describe("Token store — auth-tag protection", () => {
  it("flipping a byte in the ciphertext makes decryption fail", async () => {
    await upsertToken({
      userId: "u", provider: "google-drive", accountId: "a",
      accessToken: "important-secret",
    });
    const r = rows[0];
    // Flip one base64 char — first non-padding char
    const ct = Buffer.from(r.access_token, "base64");
    ct[ct.length - 1] = ct[ct.length - 1] ^ 0xff;
    r.access_token = ct.toString("base64");

    await expect(
      getToken({ userId: "u", provider: "google-drive", accountId: "a" }),
    ).rejects.toThrow();
  });
});
