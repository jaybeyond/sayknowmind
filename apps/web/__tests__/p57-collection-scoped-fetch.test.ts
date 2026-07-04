/**
 * Property 57: Collection selection scopes the memories fetch server-side.
 *
 * Regression for the "test01 shows 5 items but opens empty" bug: fetchMemories
 * only loaded the newest PAGE_SIZE documents and collection filtering happened
 * client-side over that window, so a collection whose items were older than the
 * newest page looked empty while its count said otherwise. Selecting a
 * collection/folder/tab must refetch with a categoryId filter (including
 * descendant folders), and the API must accept a comma-separated id list.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getOrgContext: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  pool: { query: mocks.query },
}));

vi.mock("@/lib/org-context", () => ({
  getOrgContext: mocks.getOrgContext,
  isOrgAdmin: (role: string) => role === "owner" || role === "admin",
}));

describe("GET /api/documents category scoping", () => {
  let getDocuments: typeof import("@/app/api/documents/route").GET;

  beforeAll(async () => {
    getDocuments = (await import("@/app/api/documents/route")).GET;
  });

  beforeEach(() => {
    mocks.query.mockReset();
    mocks.getOrgContext.mockResolvedValue({
      userId: "user-1",
      organizationId: "org-1",
      role: "owner",
    });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("COUNT(*)")) return { rows: [{ count: "0" }] };
      return { rows: [] };
    });
  });

  it("filters by every id in a comma-separated categoryId list", async () => {
    const res = await getDocuments(
      new NextRequest("http://localhost/api/documents?categoryId=cat-a,cat-b&page=1&limit=20"),
    );
    expect(res.status).toBe(200);

    const countCall = mocks.query.mock.calls.find(([sql]) => (sql as string).includes("COUNT(*)"))!;
    expect(countCall).toBeDefined();
    const [sql, params] = countCall as [string, unknown[]];
    expect(sql).toContain("dc.category_id = ANY(");
    expect(params).toContainEqual(["cat-a", "cat-b"]);
  });

  it("keeps single-id filtering and skips the clause when absent", async () => {
    await getDocuments(new NextRequest("http://localhost/api/documents?categoryId=cat-a"));
    const [singleSql, singleParams] = mocks.query.mock.calls[0] as [string, unknown[]];
    expect(singleSql).toContain("dc.category_id = ANY(");
    expect(singleParams).toContainEqual(["cat-a"]);

    mocks.query.mockClear();
    await getDocuments(new NextRequest("http://localhost/api/documents"));
    const [noneSql] = mocks.query.mock.calls[0] as [string];
    expect(noneSql).not.toContain("dc.category_id");
  });
});

describe("memory-store refetches scoped to the selected collection", () => {
  let useMemoryStore: typeof import("@/store/memory-store").useMemoryStore;
  let useCategoriesStore: typeof import("@/store/categories-store").useCategoriesStore;
  const fetchMock = vi.fn();

  const category = (id: string, parent_id: string | null) => ({
    id,
    name: id,
    color: null,
    depth: parent_id ? 1 : 0,
    path: id,
    parent_id,
    kind: "collection" as const,
  });

  beforeAll(async () => {
    vi.stubGlobal("fetch", fetchMock);
    useMemoryStore = (await import("@/store/memory-store")).useMemoryStore;
    useCategoriesStore = (await import("@/store/categories-store")).useCategoriesStore;
  });

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ documents: [], pagination: { total: 0, hasMore: false } }),
    });
    useCategoriesStore.setState({
      categories: [category("cat-test01", null), category("cat-child", "cat-test01")],
    });
    useMemoryStore.setState({ selectedCollection: "all", selectedTab: null, memories: [] });
  });

  const lastFetchedUrl = () => String(fetchMock.mock.calls.at(-1)?.[0] ?? "");

  it("selecting a collection fetches it AND its descendant folders", async () => {
    useMemoryStore.getState().setSelectedCollection("cat-test01");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const url = new URL(lastFetchedUrl(), "http://localhost");
    expect(url.pathname).toBe("/api/documents");
    expect(url.searchParams.get("categoryId")).toBe("cat-test01,cat-child");
  });

  it("selecting a sub-tab narrows to exactly that category", async () => {
    useMemoryStore.setState({ selectedCollection: "cat-test01" });
    useMemoryStore.getState().setSelectedTab("cat-child");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const url = new URL(lastFetchedUrl(), "http://localhost");
    expect(url.searchParams.get("categoryId")).toBe("cat-child");
  });

  it("returning to All Memories drops the scope again", async () => {
    useMemoryStore.getState().setSelectedCollection("all");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const url = new URL(lastFetchedUrl(), "http://localhost");
    expect(url.searchParams.get("categoryId")).toBeNull();
  });
});
