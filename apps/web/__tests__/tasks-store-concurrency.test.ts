import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTasksStore } from "@/store/tasks-store";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  useTasksStore.setState({
    tasks: [],
    members: [],
    membersByProject: {},
    projects: [],
    taskMode: "bi",
    selectedProjectId: null,
    isLoading: false,
    error: null,
    selectedTaskId: null,
    scope: "all",
  });
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tasks store concurrency", () => {
  it("deduplicates simultaneous member requests for one project", async () => {
    const pending = deferredResponse();
    vi.mocked(fetch).mockReturnValue(pending.promise);

    const first = useTasksStore.getState().fetchMembers("project-a");
    const second = useTasksStore.getState().fetchMembers("project-a");
    expect(fetch).toHaveBeenCalledTimes(1);

    pending.resolve(jsonResponse({ members: [] }));
    await Promise.all([first, second]);
    expect(useTasksStore.getState().membersByProject["project-a"]).toEqual([]);
  });

  it("does not let a slower old project response replace the latest project", async () => {
    const projectA = deferredResponse();
    const projectB = deferredResponse();
    vi.mocked(fetch)
      .mockReturnValueOnce(projectA.promise)
      .mockReturnValueOnce(projectB.promise);

    useTasksStore.setState({ selectedProjectId: "project-a" });
    const first = useTasksStore.getState().fetchTasks();
    useTasksStore.setState({ selectedProjectId: "project-b" });
    const second = useTasksStore.getState().fetchTasks();

    projectB.resolve(jsonResponse({ tasks: [{ id: "task-b", projectId: "project-b" }] }));
    await second;
    projectA.resolve(jsonResponse({ tasks: [{ id: "task-a", projectId: "project-a" }] }));
    await first;

    expect(useTasksStore.getState().tasks).toEqual([
      expect.objectContaining({ id: "task-b", projectId: "project-b" }),
    ]);
  });
});
