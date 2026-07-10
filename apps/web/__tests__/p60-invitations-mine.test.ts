import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getUserIdFromRequest: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  pool: { query: mocks.query },
}));

vi.mock("@/lib/ingest/session-helper", () => ({
  getUserIdFromRequest: mocks.getUserIdFromRequest,
}));

let getMine: typeof import("@/app/api/invitations/mine/route").GET;

describe("GET /api/invitations/mine", () => {
  beforeAll(async () => {
    getMine = (await import("@/app/api/invitations/mine/route")).GET;
  });

  beforeEach(() => {
    mocks.query.mockReset();
    mocks.getUserIdFromRequest.mockReset();
  });

  it("rejects an unauthenticated caller with 401", async () => {
    mocks.getUserIdFromRequest.mockResolvedValue(null);

    const res = await getMine();

    expect(res.status).toBe(401);
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("returns an empty list when the account has no email on file", async () => {
    mocks.getUserIdFromRequest.mockResolvedValue("user-1");
    mocks.query.mockResolvedValueOnce({ rows: [] }); // user email lookup

    const res = await getMine();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ invitations: [] });
    // No invitation query issued once the email is missing.
    expect(mocks.query).toHaveBeenCalledTimes(1);
  });

  it("only surfaces pending, unexpired invitations matched case-insensitively and joined to the org name", async () => {
    const executed: { sql: string; params: unknown[] }[] = [];
    mocks.getUserIdFromRequest.mockResolvedValue("user-1");
    mocks.query.mockImplementation(async (sql: string, params: unknown[]) => {
      const normalized = sql.replace(/\s+/g, " ").toLowerCase();
      executed.push({ sql: normalized, params });

      if (normalized.includes('from "user"')) {
        return { rows: [{ email: "12345@sayknow.local" }] };
      }
      if (normalized.includes("from invitation")) {
        return {
          rows: [
            {
              id: "inv-1",
              role: "member",
              status: "pending",
              expiresAt: new Date("2099-01-01T00:00:00Z"),
              organizationId: "org-9",
              organizationName: "Growth Team",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const res = await getMine();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.invitations).toEqual([
      {
        id: "inv-1",
        role: "member",
        status: "pending",
        expiresAt: "2099-01-01T00:00:00.000Z",
        organizationId: "org-9",
        organizationName: "Growth Team",
      },
    ]);

    const inviteQuery = executed.find((q) => q.sql.includes("from invitation"));
    expect(inviteQuery).toBeDefined();
    // Guards: pending-only, unexpired, case-insensitive email, org name joined.
    expect(inviteQuery!.sql).toContain("status = 'pending'");
    expect(inviteQuery!.sql).toContain('i."expiresat" > now()');
    expect(inviteQuery!.sql).toContain("lower(i.email) = lower($1)");
    expect(inviteQuery!.sql).toContain("join organization o");
    expect(inviteQuery!.params).toEqual(["12345@sayknow.local"]);
  });
});
