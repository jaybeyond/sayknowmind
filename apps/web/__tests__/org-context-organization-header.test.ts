import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  getSession: vi.fn(),
  getUserIdFromRequest: vi.fn(),
  query: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/ingest/session-helper", () => ({ getUserIdFromRequest: mocks.getUserIdFromRequest }));
vi.mock("@/lib/db", () => ({ pool: { query: mocks.query } }));

beforeEach(() => {
  vi.resetModules();
  mocks.headers.mockReset();
  mocks.getSession.mockReset();
  mocks.getUserIdFromRequest.mockReset();
  mocks.query.mockReset();
  mocks.getUserIdFromRequest.mockResolvedValue("user-1");
  mocks.getSession.mockResolvedValue(null);
});

describe("organization request header", () => {
  it("uses an explicitly requested organization after validating membership", async () => {
    mocks.headers.mockResolvedValue(new Headers({ "x-organization-id": "org-target" }));
    mocks.query.mockImplementation(async (sql: string, params: unknown[]) => {
      if (/AND\s+m\."organizationId" = \$2/.test(sql)) {
        expect(params).toEqual(["user-1", "org-target"]);
        return { rows: [{ organizationId: "org-target", role: "member" }] };
      }
      return { rows: [{ organizationId: "org-fallback", role: "owner" }] };
    });

    const { getOrgContext } = await import("@/lib/org-context");
    await expect(getOrgContext()).resolves.toEqual({
      userId: "user-1",
      organizationId: "org-target",
      role: "member",
    });
  });

  it("does not fall back to another organization when the requested one is unauthorized", async () => {
    mocks.headers.mockResolvedValue(new Headers({ "x-organization-id": "org-forbidden" }));
    mocks.query.mockImplementation(async (sql: string) => {
      if (/AND\s+m\."organizationId" = \$2/.test(sql)) return { rows: [] };
      return { rows: [{ organizationId: "org-fallback", role: "owner" }] };
    });

    const { getOrgContext } = await import("@/lib/org-context");
    await expect(getOrgContext()).resolves.toBeNull();
  });
});
