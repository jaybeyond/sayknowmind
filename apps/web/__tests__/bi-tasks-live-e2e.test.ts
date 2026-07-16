import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OrgContext } from "@/lib/org-context";

const liveEnabled = process.env.BI_LIVE_E2E === "true";
const liveDescribe = liveEnabled ? describe : describe.skip;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing live E2E environment variable: ${name}`);
  return value;
}

liveDescribe("BI task bridge live E2E", () => {
  let bridge: typeof import("@/lib/integrations/bi-tasks");
  let serviceToken = "";
  let bobToken = "";

  const aliceCtx: OrgContext = {
    userId: "mind-e2e-alice",
    organizationId: "mind-e2e-org",
    role: "member",
  };
  const carolCtx: OrgContext = {
    userId: "mind-e2e-carol",
    organizationId: "mind-e2e-org",
    role: "member",
  };

  async function login(email: string): Promise<string> {
    const response = await fetch(`${required("BI_API_BASE_URL")}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: required("BI_SERVICE_PASSWORD") }),
    });
    expect(response.status).toBe(200);
    return ((await response.json()) as { token: string }).token;
  }

  async function normalBi(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${bobToken}`);
    if (init.body) headers.set("Content-Type", "application/json");
    return fetch(`${required("BI_API_BASE_URL")}${path}`, { ...init, headers });
  }

  beforeAll(async () => {
    bridge = await import("@/lib/integrations/bi-tasks");
    serviceToken = await login(required("BI_SERVICE_LOGIN_ID"));
    bobToken = await login(required("BI_LIVE_E2E_BOB_LOGIN_ID"));
    expect(serviceToken).toBeTruthy();
  });

  afterAll(async () => {
    const { pool } = await import("@/lib/db");
    await pool.end();
  });

  it("runs Mind bridge code against BI across two users and projects", async () => {
    const alphaProjectId = required("BI_LIVE_E2E_ALPHA_PROJECT_ID");
    const betaProjectId = required("BI_LIVE_E2E_BETA_PROJECT_ID");
    const privateProjectId = required("BI_LIVE_E2E_PRIVATE_PROJECT_ID");
    let createdTaskId: string | null = null;

    try {
      const projects = await bridge.listBiTaskProjects(aliceCtx);
      expect(projects.map((project) => project.id).sort()).toEqual(
        [alphaProjectId, betaProjectId].sort(),
      );

      const members = await bridge.listBiTaskMembers(aliceCtx, alphaProjectId);
      expect(members.map((member) => member.email).sort()).toEqual(
        ["alice@e2e.local", "bob@e2e.local"],
      );

      const existingBetaTasks = await bridge.listBiTasks(aliceCtx, "all", betaProjectId);
      expect(existingBetaTasks.some((task) => task.title === "Beta existing task")).toBe(true);

      const expectedPaginationCount = Number(process.env.BI_LIVE_E2E_PAGINATION_COUNT ?? 0);
      if (expectedPaginationCount > 0) {
        const alphaTasks = await bridge.listBiTasks(aliceCtx, "all", alphaProjectId);
        expect(
          alphaTasks.filter((task) => task.title.startsWith("Pagination E2E ")),
        ).toHaveLength(expectedPaginationCount);
      }

      const created = await bridge.createBiTask(aliceCtx, {
        title: "Created by real Mind bridge",
        projectId: alphaProjectId,
        status: "todo",
        priority: "high",
        dueDate: "2026-07-30T10:00:00.000Z",
      });
      createdTaskId = created.id;
      expect(created.projectId).toBe(alphaProjectId);
      expect(created.assignee?.email).toBe("alice@e2e.local");

      const biRead = await normalBi(`/tasks/${created.id}`);
      expect(biRead.status).toBe(200);
      await expect(biRead.json()).resolves.toMatchObject({ title: "Created by real Mind bridge" });

      const biUpdate = await normalBi(`/tasks/${created.id}`, {
        method: "PUT",
        body: JSON.stringify({ title: "Updated in BI during live bridge test", status: "executing" }),
      });
      expect(biUpdate.status).toBe(200);

      const mindReadback = await bridge.listBiTasks(aliceCtx, "all", alphaProjectId);
      expect(mindReadback).toContainEqual(
        expect.objectContaining({
          id: created.id,
          title: "Updated in BI during live bridge test",
          status: "in-progress",
        }),
      );

      await expect(
        bridge.listBiTasks(carolCtx, "all", alphaProjectId),
      ).rejects.toMatchObject({ status: 404 });
      const carolProjects = await bridge.listBiTaskProjects(carolCtx);
      expect(carolProjects.map((project) => project.id)).toEqual([privateProjectId]);

      await bridge.deleteBiTask(aliceCtx, created.id);
      createdTaskId = null;
      expect((await normalBi(`/tasks/${created.id}`)).status).toBe(404);
    } finally {
      if (createdTaskId) {
        await normalBi(`/tasks/${createdTaskId}`, { method: "DELETE" }).catch(() => {});
      }
    }
  });
});
