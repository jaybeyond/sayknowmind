import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getOrgContext: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ pool: { query: mocks.query } }));
vi.mock("@/lib/org-context", () => ({
  getOrgContext: mocks.getOrgContext,
  isOrgAdmin: (role: string) => role === "owner" || role === "admin",
}));

const ctx = { userId: "mind-user-1", organizationId: "mind-org-1", role: "member" };
const otherCtx = { userId: "mind-user-2", organizationId: "mind-org-2", role: "member" };

const BI_ENV_KEYS = [
  "BI_TASKS_ENABLED",
  "BI_API_BASE_URL",
  "BI_SERVICE_TOKEN",
  "BI_SERVICE_LOGIN_ID",
  "BI_SERVICE_PASSWORD",
  "BI_ORG_PROJECT_MAP",
  "BI_TASKS_ORGANIZATION_IDS",
  "BI_DEFAULT_PROJECT_ID",
  "BI_USER_MAP",
  "BI_DEFAULT_ASSIGNEE_ID",
] as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function biMember(id: string, email: string) {
  return { id, name: id, email, avatar: null };
}

function biTask(id: string, projectId = "bi-project-1") {
  return {
    id,
    title: id,
    description: "",
    status: "planning",
    priority: "medium",
    priorityLevel: "P3",
    projectId,
    assigneeId: "bi-member-1",
    assignee: biMember("bi-member-1", "member1@example.com"),
    dueDate: "2026-07-20T10:00:00.000Z",
    tags: [],
    progress: 0,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
  };
}

function mappedProject() {
  return [
    biMember("bi-owner", "owner@example.com"),
    biMember("bi-member-1", "member1@example.com"),
    biMember("bi-member-2", "member2@example.com"),
  ];
}

beforeEach(() => {
  vi.resetModules();
  mocks.query.mockReset();
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.getOrgContext.mockReset();
  mocks.getOrgContext.mockResolvedValue(ctx);
  vi.stubGlobal("fetch", vi.fn());

  process.env.BI_TASKS_ENABLED = "true";
  process.env.BI_API_BASE_URL = "https://bi.test/api";
  process.env.BI_SERVICE_TOKEN = "service-token";
  process.env.BI_ORG_PROJECT_MAP = JSON.stringify({ "mind-org-1": "bi-project-1" });
  process.env.BI_TASKS_ORGANIZATION_IDS = "";
  process.env.BI_DEFAULT_PROJECT_ID = "";
  process.env.BI_USER_MAP = JSON.stringify({ "mind-user-1": "bi-member-1" });
  process.env.BI_DEFAULT_ASSIGNEE_ID = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of BI_ENV_KEYS) delete process.env[key];
});

describe("BI task bridge hardening", () => {
  it("enables the bridge only for an explicitly mapped organization", async () => {
    const mod = await import("@/lib/integrations/bi-tasks");
    const isEnabled = mod.isBiTasksEnabled as unknown as (org: typeof ctx) => boolean;

    expect(isEnabled(ctx)).toBe(true);
    expect(isEnabled(otherCtx)).toBe(false);
  });

  it("requires an allowlisted organization before using the default project", async () => {
    process.env.BI_ORG_PROJECT_MAP = "{}";
    process.env.BI_DEFAULT_PROJECT_ID = "bi-default";
    process.env.BI_TASKS_ORGANIZATION_IDS = "mind-org-1";
    const mod = await import("@/lib/integrations/bi-tasks");
    const isEnabled = mod.isBiTasksEnabled as unknown as (org: typeof ctx) => boolean;

    expect(isEnabled(ctx)).toBe(true);
    expect(isEnabled(otherCtx)).toBe(false);
  });

  it("fails closed when an organization map contains a non-string project id", async () => {
    process.env.BI_ORG_PROJECT_MAP = JSON.stringify({ "mind-org-1": 123 });
    const mod = await import("@/lib/integrations/bi-tasks");

    expect(mod.isBiTasksEnabled(ctx)).toBe(false);
  });

  it("keeps unmapped organizations on their existing local Mind tasks", async () => {
    mocks.getOrgContext.mockResolvedValue(otherCtx);
    mocks.query.mockImplementation(async (sql: string) => {
      const normalized = sql.replace(/\s+/g, " ");
      if (normalized.includes("JOIN organization o")) {
        return { rows: [{ id: "mind-org-2", is_personal: false }] };
      }
      if (normalized.includes("FROM work_items w")) {
        return {
          rows: [{
            id: "local-task",
            identifier: "TASK-1",
            title: "Local task",
            description: null,
            status: "backlog",
            priority: "no-priority",
            labels: [],
            rank: "1",
            start_date: null,
            due_date: null,
            document_id: null,
            created_at: "2026-07-11T00:00:00.000Z",
            updated_at: "2026-07-11T00:00:00.000Z",
            completed_at: null,
            assignee_id: null,
            assignee_name: null,
            assignee_email: null,
            assignee_image: null,
          }],
        };
      }
      return { rows: [] };
    });

    const { GET } = await import("@/app/api/tasks/route");
    const response = await GET(new NextRequest("http://localhost/api/tasks?scope=all"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ tasks: [{ id: "local-task" }] });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("always creates in the mapped project even if a caller submits another project id", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/projects/bi-project-1/members")) return jsonResponse(mappedProject());
      if (url.endsWith("/tasks") && init?.method === "POST") return jsonResponse(biTask("created"), 201);
      throw new Error(`Unexpected BI request: ${init?.method ?? "GET"} ${url}`);
    });

    const mod = await import("@/lib/integrations/bi-tasks");
    await mod.createBiTask(ctx, {
      title: "Safe project",
      assigneeId: "mind-user-1",
      projectId: "bi-project-other",
    });

    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(createCall).toBeDefined();
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({ projectId: "bi-project-1" });
  });

  it("maps a SayKnowMind user to a BI project member by shared email", async () => {
    process.env.BI_USER_MAP = "{}";
    mocks.query.mockResolvedValue({
      rows: [{ id: "mind-user-1", name: "Mind user", email: "MEMBER1@example.com", image: null }],
    });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/projects/bi-project-1/members")) return jsonResponse(mappedProject());
      if (url.endsWith("/tasks") && init?.method === "POST") return jsonResponse(biTask("created"), 201);
      throw new Error(`Unexpected BI request: ${init?.method ?? "GET"} ${url}`);
    });

    const mod = await import("@/lib/integrations/bi-tasks");
    await mod.createBiTask(ctx, { title: "Email mapping" });

    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({ assigneeId: "bi-member-1" });
  });

  it("rejects updating a task outside the mapped project", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/tasks/task-other") && !init?.method) {
        return jsonResponse(biTask("task-other", "bi-project-other"));
      }
      throw new Error(`Unexpected BI request: ${init?.method ?? "GET"} ${url}`);
    });

    const mod = await import("@/lib/integrations/bi-tasks");
    const update = mod.updateBiTask as unknown as (
      org: typeof ctx,
      id: string,
      body: Record<string, unknown>,
    ) => Promise<unknown>;

    await expect(update(ctx, "task-other", { title: "blocked" })).rejects.toMatchObject({ status: 404 });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("rejects deleting a task outside the mapped project", async () => {
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/tasks/task-other") && !init?.method) {
        return jsonResponse(biTask("task-other", "bi-project-other"));
      }
      throw new Error(`Unexpected BI request: ${init?.method ?? "GET"} ${url}`);
    });

    const mod = await import("@/lib/integrations/bi-tasks");
    const remove = mod.deleteBiTask as unknown as (org: typeof ctx, id: string) => Promise<void>;

    await expect(remove(ctx, "task-other")).rejects.toMatchObject({ status: 404 });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("updates a task after confirming it belongs to the mapped project", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/tasks/task-1") && !init?.method) return jsonResponse(biTask("task-1"));
      if (url.endsWith("/tasks/task-1") && init?.method === "PUT") {
        return jsonResponse({ ...biTask("task-1"), title: "Updated" });
      }
      throw new Error(`Unexpected BI request: ${init?.method ?? "GET"} ${url}`);
    });

    const mod = await import("@/lib/integrations/bi-tasks");
    const updated = await mod.updateBiTask(ctx, "task-1", { title: "Updated" });

    expect(updated.title).toBe("Updated");
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(["GET", "PUT"]);
  });

  it("deletes a task only after confirming it belongs to the mapped project", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/tasks/task-1") && !init?.method) return jsonResponse(biTask("task-1"));
      if (url.endsWith("/tasks/task-1") && init?.method === "DELETE") {
        return jsonResponse({ success: true });
      }
      throw new Error(`Unexpected BI request: ${init?.method ?? "GET"} ${url}`);
    });

    const mod = await import("@/lib/integrations/bi-tasks");
    await expect(mod.deleteBiTask(ctx, "task-1")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(["GET", "DELETE"]);
  });

  it("returns 404 from the task route for a cross-project task id", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/tasks/task-other") && !init?.method) {
        return jsonResponse(biTask("task-other", "bi-project-other"));
      }
      throw new Error(`Unexpected BI request: ${init?.method ?? "GET"} ${url}`);
    });

    const { PATCH } = await import("@/app/api/tasks/[id]/route");
    const response = await PATCH(
      new NextRequest("http://localhost/api/tasks/task-other", {
        method: "PATCH",
        body: JSON.stringify({ title: "blocked" }),
      }),
      { params: Promise.resolve({ id: "task-other" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ message: "Not found" });
    errorSpy.mockRestore();
  });

  it("returns only the owner and members of the mapped BI project", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/projects/bi-project-1/members")) return jsonResponse(mappedProject());
      throw new Error(`Unexpected BI request: GET ${url}`);
    });

    const mod = await import("@/lib/integrations/bi-tasks");
    const listMembers = mod.listBiTaskMembers as unknown as (org: typeof ctx) => Promise<Array<{ id: string }>>;
    const members = await listMembers(ctx);

    expect(members.map((member) => member.id)).toEqual(["bi-owner", "bi-member-1", "bi-member-2"]);
  });

  it("loads every BI task page for the mapped project", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("projectId")).toBe("bi-project-1");
      if (url.searchParams.get("page") === "1") {
        return jsonResponse({ data: [biTask("task-1")], page: 1, pageSize: 200, totalPages: 2 });
      }
      return jsonResponse({ data: [biTask("task-2")], page: 2, pageSize: 200, totalPages: 2 });
    });

    const mod = await import("@/lib/integrations/bi-tasks");
    const tasks = await mod.listBiTasks(ctx);

    expect(tasks.map((task) => task.id)).toEqual(["task-1", "task-2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("filters personal task scope to the mapped BI assignee", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/projects/bi-project-1/members")) return jsonResponse(mappedProject());
      if (url.includes("/tasks?")) return jsonResponse({ data: [], page: 1, pageSize: 200, totalPages: 1 });
      throw new Error(`Unexpected BI request: GET ${url}`);
    });

    const mod = await import("@/lib/integrations/bi-tasks");
    const list = mod.listBiTasks as unknown as (org: typeof ctx, scope: string) => Promise<unknown[]>;
    await list(ctx, "personal");

    const taskCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/tasks?"));
    const taskUrl = new URL(String(taskCall?.[0]));
    expect(taskUrl.searchParams.get("assigneeId")).toBe("bi-member-1");
  });

  it("does not show the default assignee's personal tasks to an unmapped user", async () => {
    process.env.BI_USER_MAP = "{}";
    process.env.BI_DEFAULT_ASSIGNEE_ID = "bi-member-2";
    mocks.query.mockResolvedValue({ rows: [{ id: "mind-user-1", email: "unknown@example.com" }] });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/projects/bi-project-1/members")) return jsonResponse(mappedProject());
      throw new Error(`Unexpected BI request: GET ${url}`);
    });

    const mod = await import("@/lib/integrations/bi-tasks");
    await expect(mod.listBiTasks(ctx, "personal")).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
