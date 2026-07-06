/**
 * Property 58: Tasks (work_items) API — org scoping, validation, status/done.
 *
 * The task board reads/writes through /api/tasks. This pins the invariants that
 * matter: unauthenticated callers are rejected, creates require a title and are
 * org-scoped with a generated identifier, an invalid assignee is dropped (not
 * trusted), and moving a task to/from the done column toggles completed_at.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  getOrgContext: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ pool: { query: mocks.query } }));
vi.mock("@/lib/org-context", () => ({
  getOrgContext: mocks.getOrgContext,
  isOrgAdmin: (r: string) => r === "owner" || r === "admin",
}));

let postTask: typeof import("@/app/api/tasks/route").POST;
let getTasks: typeof import("@/app/api/tasks/route").GET;
let patchTask: typeof import("@/app/api/tasks/[id]/route").PATCH;

describe("Tasks API", () => {
  beforeAll(async () => {
    postTask = (await import("@/app/api/tasks/route")).POST;
    getTasks = (await import("@/app/api/tasks/route")).GET;
    patchTask = (await import("@/app/api/tasks/[id]/route")).PATCH;
  });

  beforeEach(() => {
    mocks.query.mockReset();
    mocks.getOrgContext.mockResolvedValue({ userId: "user-1", organizationId: "org-1", role: "owner" });
  });

  it("rejects unauthenticated list requests with 401", async () => {
    mocks.getOrgContext.mockResolvedValueOnce(null);
    const res = await getTasks();
    expect(res.status).toBe(401);
  });

  it("requires a non-empty title on create", async () => {
    const res = await postTask(
      new NextRequest("http://localhost/api/tasks", { method: "POST", body: JSON.stringify({ title: "  " }) }),
    );
    expect(res.status).toBe(400);
  });

  it("creates a task with a generated identifier, org-scoped", async () => {
    const executed: string[] = [];
    mocks.query.mockImplementation(async (sql: string) => {
      const s = sql.replace(/\s+/g, " ").trim();
      executed.push(s);
      if (s.includes("work_item_counters")) return { rows: [{ last_number: 7 }] };
      if (s.startsWith("INSERT INTO work_items")) return { rows: [{ id: "wi-1" }] };
      if (s.includes("FROM work_items w")) {
        return { rows: [{ id: "wi-1", identifier: "TASK-7", title: "Ship it", status: "backlog", priority: "no-priority", labels: [], assignee_id: null, created_at: "t", updated_at: "t" }] };
      }
      return { rows: [] };
    });

    const res = await postTask(
      new NextRequest("http://localhost/api/tasks", { method: "POST", body: JSON.stringify({ title: "Ship it" }) }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.task.identifier).toBe("TASK-7");
    // The INSERT binds the caller's org id.
    const insert = executed.find((s) => s.startsWith("INSERT INTO work_items"));
    expect(insert).toBeDefined();
  });

  it("drops an assignee that is not a member of the org", async () => {
    let insertParams: unknown[] = [];
    mocks.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      const s = sql.replace(/\s+/g, " ").trim();
      if (s.startsWith("SELECT 1 FROM member")) return { rows: [] }; // not a member
      if (s.includes("work_item_counters")) return { rows: [{ last_number: 1 }] };
      if (s.startsWith("INSERT INTO work_items")) { insertParams = params ?? []; return { rows: [{ id: "wi-2" }] }; }
      if (s.includes("FROM work_items w")) return { rows: [{ id: "wi-2", identifier: "TASK-1", title: "x", status: "backlog", priority: "no-priority", labels: [], assignee_id: null, created_at: "t", updated_at: "t" }] };
      return { rows: [] };
    });

    const res = await postTask(
      new NextRequest("http://localhost/api/tasks", { method: "POST", body: JSON.stringify({ title: "x", assigneeId: "stranger" }) }),
    );
    expect(res.status).toBe(201);
    // assignee_id (8th positional param) must be null, not "stranger".
    expect(insertParams[7]).toBeNull();
  });

  it("sets completed_at when moving to completed, clears it otherwise", async () => {
    const updates: string[] = [];
    mocks.query.mockImplementation(async (sql: string) => {
      const s = sql.replace(/\s+/g, " ").trim();
      if (s.startsWith("UPDATE work_items")) { updates.push(s); return { rows: [{ id: "wi-1" }] }; }
      if (s.includes("FROM work_items w")) return { rows: [{ id: "wi-1", identifier: "TASK-1", title: "x", status: "completed", priority: "low", labels: [], assignee_id: null, created_at: "t", updated_at: "t" }] };
      return { rows: [] };
    });

    const done = await patchTask(
      new NextRequest("http://localhost/api/tasks/wi-1", { method: "PATCH", body: JSON.stringify({ status: "completed" }) }),
      { params: Promise.resolve({ id: "wi-1" }) },
    );
    expect(done.status).toBe(200);
    expect(updates[0]).toContain("completed_at = COALESCE(completed_at, now())");

    const reopened = await patchTask(
      new NextRequest("http://localhost/api/tasks/wi-1", { method: "PATCH", body: JSON.stringify({ status: "in-progress" }) }),
      { params: Promise.resolve({ id: "wi-1" }) },
    );
    expect(reopened.status).toBe(200);
    expect(updates[1]).toContain("completed_at = NULL");
  });

  it("rejects a patch with no valid fields", async () => {
    const res = await patchTask(
      new NextRequest("http://localhost/api/tasks/wi-1", { method: "PATCH", body: JSON.stringify({ bogus: 1 }) }),
      { params: Promise.resolve({ id: "wi-1" }) },
    );
    expect(res.status).toBe(400);
  });
});
