import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getOrgContext: vi.fn(),
  listCategories: vi.fn(),
  ensureKnowledgeSchema: vi.fn(),
  ensureSharedContentSchema: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ pool: { query: mocks.query } }));
vi.mock("@/lib/org-context", () => ({
  getOrgContext: mocks.getOrgContext,
  isOrgAdmin: () => false,
}));
vi.mock("@/lib/categories/store", () => ({
  listCategories: mocks.listCategories,
  createCategory: vi.fn(),
}));
vi.mock("@/lib/schema-compat", () => ({
  ensureKnowledgeSchema: mocks.ensureKnowledgeSchema,
  ensureSharedContentSchema: mocks.ensureSharedContentSchema,
}));

beforeEach(() => {
  vi.resetModules();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getOrgContext.mockResolvedValue({
    userId: "user-1",
    organizationId: "org-1",
    role: "owner",
  });
  mocks.ensureKnowledgeSchema.mockResolvedValue(undefined);
  mocks.ensureSharedContentSchema.mockResolvedValue(undefined);
  mocks.listCategories.mockResolvedValue([]);
  mocks.query.mockResolvedValue({ rows: [] });
});
describe("knowledge routes repair schema before querying", () => {
  it("repairs document visibility tables before listing documents", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ count: "0" }] })
      .mockResolvedValueOnce({ rows: [] });
    const route = await import("@/app/api/documents/route");

    const response = await route.GET(new NextRequest("http://localhost/api/documents?limit=1"));

    expect(response.status).toBe(200);
    expect(mocks.ensureKnowledgeSchema).toHaveBeenCalledOnce();
    expect(mocks.ensureKnowledgeSchema.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.query.mock.invocationCallOrder[0]);
  });

  it("repairs category visibility tables before listing categories", async () => {
    const route = await import("@/app/api/categories/route");

    const response = await route.GET(new NextRequest("http://localhost/api/categories"));

    expect(response.status).toBe(200);
    expect(mocks.ensureKnowledgeSchema).toHaveBeenCalledOnce();
    expect(mocks.ensureKnowledgeSchema.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.listCategories.mock.invocationCallOrder[0]);
  });

  it("repairs shared-content columns before loading the public gallery", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ total: "0" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const route = await import("@/app/api/share/gallery/route");

    const response = await route.GET(new NextRequest("http://localhost/api/share/gallery"));

    expect(response.status).toBe(200);
    expect(mocks.ensureSharedContentSchema).toHaveBeenCalledOnce();
    expect(mocks.ensureSharedContentSchema.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.query.mock.invocationCallOrder[0]);
  });
});
