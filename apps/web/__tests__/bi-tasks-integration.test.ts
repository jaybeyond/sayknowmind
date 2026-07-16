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
const SECRET = "mind-bi-integration-test-secret-at-least-32-bytes";

const BI_ENV_KEYS = [
  "BI_TASKS_ENABLED",
  "BI_API_BASE_URL",
  "BI_SERVICE_TOKEN",
  "BI_SERVICE_LOGIN_ID",
  "BI_SERVICE_PASSWORD",
  "BI_INTEGRATION_SECRET",
  "BI_ORG_PROJECT_MAP",
  "BI_TASKS_ORGANIZATION_IDS",
  "BI_DEFAULT_PROJECT_ID",
  "BI_USER_MAP",
  "BI_DEFAULT_ASSIGNEE_ID",
] as const;

function jsonResponse(body: unknown, status = 200, delegated = true): Response {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (delegated) headers.set("X-SayKnowMind-Integration", "delegated");
  return new Response(JSON.stringify(body), { status, headers });
}

function biMember(id: string, email: string) {
  return { id, name: id, email, avatar: null };
}

function biProject(id: string) {
  return { id, name: `Project ${id}`, color: "#2563eb", status: "executing" };
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
    project: biProject(projectId),
    assigneeId: "bi-member-1",
    assignee: biMember("bi-member-1", "member1@example.com"),
    dueDate: "2026-07-20T10:00:00.000Z",
    tags: [],
    progress: 0,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
  };
}

function projectMembers(projectId: string) {
  return [
    biMember(`${projectId}-owner`, "owner@example.com"),
    biMember("bi-member-1", "member1@example.com"),
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
  process.env.BI_INTEGRATION_SECRET = SECRET;
  process.env.BI_TASKS_ORGANIZATION_IDS = "mind-org-1";
  process.env.BI_ORG_PROJECT_MAP = "{}";
  process.env.BI_USER_MAP = JSON.stringify({ "mind-user-1": "bi-member-1" });
  process.env.BI_DEFAULT_ASSIGNEE_ID = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of BI_ENV_KEYS) delete process.env[key];
});

describe("BI multi-project task bridge", () => {
  it("enables only allowlisted Mind organizations and keeps the legacy map as an allowlist", async () => {
    const mod = await import("@/lib/integrations/bi-tasks");
    expect(mod.isBiTasksEnabled(ctx)).toBe(true);
    expect(mod.isBiTasksEnabled(otherCtx)).toBe(false);

    process.env.BI_TASKS_ORGANIZATION_IDS = "";
    process.env.BI_ORG_PROJECT_MAP = JSON.stringify({ "mind-org-2": "legacy-project" });
    expect(mod.isBiTasksEnabled(otherCtx)).toBe(true);
  });

  it("keeps organizations outside the allowlist on local Mind tasks", async () => {
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

  it("lists every accessible project page and signs the delegated actor id", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/projects" && url.searchParams.get("page") === "1") {
        return jsonResponse({ data: [biProject("bi-project-1")], page: 1, pageSize: 200, totalPages: 2 });
      }
      if (url.pathname === "/api/projects" && url.searchParams.get("page") === "2") {
        return jsonResponse({ data: [biProject("bi-project-2")], page: 2, pageSize: 200, totalPages: 2 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const mod = await import("@/lib/integrations/bi-tasks");
    const projects = await mod.listBiTaskProjects(ctx);
    expect(projects.map((project) => project.id)).toEqual(["bi-project-1", "bi-project-2"]);

    const [input, init] = fetchMock.mock.calls[0];
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const timestamp = headers.get("x-integration-timestamp") ?? "";
    expect(headers.get("x-integration-actor-id")).toBe("bi-member-1");
    expect(headers.get("x-integration-actor-email")).toBeNull();
    expect(headers.get("x-integration-signature")).toBe(mod.buildBiIntegrationSignature({
      secret: SECRET,
      timestamp,
      method: "GET",
      path: `${url.pathname}${url.search}`,
      actorMemberId: "bi-member-1",
      body: "",
    }));
  });

  it("links same-email Mind and BI accounts without a manual user map", async () => {
    process.env.BI_USER_MAP = "{}";
    mocks.query.mockResolvedValue({
      rows: [{ id: "mind-user-1", name: "Mind user", email: "MEMBER1@example.com", image: null }],
    });
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      expect(new Headers(init?.headers).get("x-integration-actor-email")).toBe("member1@example.com");
      return jsonResponse({ data: [biProject("bi-project-1")], page: 1, pageSize: 200, totalPages: 1 });
    });

    const mod = await import("@/lib/integrations/bi-tasks");
    await expect(mod.listBiTaskProjects(ctx)).resolves.toHaveLength(1);
  });

  it("creates in the explicitly selected project instead of a fixed organization project", async () => {
    process.env.BI_ORG_PROJECT_MAP = JSON.stringify({ "mind-org-1": "legacy-fixed-project" });
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/projects/bi-project-2/members") {
        return jsonResponse(projectMembers("bi-project-2"));
      }
      if (url.pathname === "/api/tasks" && init?.method === "POST") {
        return jsonResponse(biTask("created", "bi-project-2"), 201);
      }
      throw new Error(`Unexpected BI request: ${init?.method ?? "GET"} ${url}`);
    });

    const mod = await import("@/lib/integrations/bi-tasks");
    const created = await mod.createBiTask(ctx, {
      title: "Selected project",
      projectId: "bi-project-2",
    });

    expect(created.projectId).toBe("bi-project-2");
    const createCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({ projectId: "bi-project-2" });
  });

  it("requires a project for BI task creation", async () => {
    const mod = await import("@/lib/integrations/bi-tasks");
    await expect(mod.createBiTask(ctx, { title: "Missing project" })).rejects.toMatchObject({ status: 400 });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("rejects Mind-only paused status instead of silently changing it", async () => {
    const mod = await import("@/lib/integrations/bi-tasks");
    await expect(mod.createBiTask(ctx, {
      title: "Paused task",
      projectId: "bi-project-1",
      status: "paused",
    })).rejects.toMatchObject({ status: 400 });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("rejects Mind-only no-priority instead of silently changing it", async () => {
    const mod = await import("@/lib/integrations/bi-tasks");
    await expect(mod.createBiTask(ctx, {
      title: "No priority task",
      projectId: "bi-project-1",
      priority: "no-priority",
    })).rejects.toMatchObject({ status: 400 });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("lists all projects, one selected project, and personal tasks with assignee=me", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input));
      return jsonResponse({ data: [biTask("task-1", url.searchParams.get("projectId") ?? "bi-project-1")], totalPages: 1 });
    });

    const mod = await import("@/lib/integrations/bi-tasks");
    await mod.listBiTasks(ctx, "all");
    await mod.listBiTasks(ctx, "all", "bi-project-2");
    await mod.listBiTasks(ctx, "personal");

    const urls = fetchMock.mock.calls.map(([input]) => new URL(String(input)));
    expect(urls[0].searchParams.get("projectId")).toBeNull();
    expect(urls[1].searchParams.get("projectId")).toBe("bi-project-2");
    expect(urls[2].searchParams.get("assigneeId")).toBe("me");
  });

  it("loads every BI task page when a project has more than 200 tasks", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = new URL(String(input));
      const page = Number(url.searchParams.get("page"));
      if (page === 1) {
        return jsonResponse({
          data: Array.from({ length: 200 }, (_, index) => biTask(`task-${index + 1}`)),
          page: 1,
          pageSize: 200,
          total: 201,
          totalPages: 2,
        });
      }
      if (page === 2) {
        return jsonResponse({
          data: [biTask("task-201")],
          page: 2,
          pageSize: 200,
          total: 201,
          totalPages: 2,
        });
      }
      throw new Error(`Unexpected page: ${page}`);
    });

    const mod = await import("@/lib/integrations/bi-tasks");
    await expect(mod.listBiTasks(ctx, "all", "bi-project-1")).resolves.toHaveLength(201);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("loads assignees only from the selected project", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/projects/bi-project-2/members");
      return jsonResponse(projectMembers("bi-project-2"));
    });

    const mod = await import("@/lib/integrations/bi-tasks");
    const members = await mod.listBiTaskMembers(ctx, "bi-project-2");
    expect(members.map((member) => member.id)).toEqual(["bi-project-2-owner", "bi-member-1"]);
  });

  it("updates and deletes only after BI authorizes the task for the delegated user", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/tasks/task-1" && !init?.method) return jsonResponse(biTask("task-1", "bi-project-2"));
      if (url.pathname === "/api/tasks/task-1" && init?.method === "PUT") {
        return jsonResponse({ ...biTask("task-1", "bi-project-2"), title: "Updated" });
      }
      if (url.pathname === "/api/tasks/task-1" && init?.method === "DELETE") return jsonResponse({ success: true });
      throw new Error(`Unexpected BI request: ${init?.method ?? "GET"} ${url}`);
    });

    const mod = await import("@/lib/integrations/bi-tasks");
    await expect(mod.updateBiTask(ctx, "task-1", { title: "Updated" })).resolves.toMatchObject({ title: "Updated" });
    await expect(mod.deleteBiTask(ctx, "task-1")).resolves.toBeUndefined();
    expect(fetchMock.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(["GET", "PUT", "GET", "DELETE"]);
  });

  it("propagates BI project denial without falling back to local or exposing data", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ error: "Not found" }, 404));
    const mod = await import("@/lib/integrations/bi-tasks");

    await expect(mod.updateBiTask(ctx, "hidden-task", { title: "blocked" })).rejects.toMatchObject({ status: 404 });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("fails closed when BI has not activated delegated access", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ data: [] }, 200, false));
    const mod = await import("@/lib/integrations/bi-tasks");

    await expect(mod.listBiTaskProjects(ctx)).rejects.toMatchObject({ status: 503 });
  });

  it("returns a clear 503 from the project endpoint when delegation is not active", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ data: [] }, 200, false));
    const { GET } = await import("@/app/api/tasks/projects/route");
    const response = await GET();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ message: "BI delegated access is not active" });
  });
});
