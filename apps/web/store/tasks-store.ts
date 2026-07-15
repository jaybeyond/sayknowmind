import { create } from "zustand";
import type {
  Task,
  TaskPriorityId,
  TaskProject,
  TaskStatusId,
} from "@/lib/tasks/constants";

export type TaskScope = "all" | "personal" | "team";
export type TaskMode = "local" | "bi";

export interface TaskMember {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

export const EMPTY_TASK_MEMBERS: TaskMember[] = [];

let taskRequestSequence = 0;
const memberRequests = new Map<string, Promise<void>>();

interface CreateTaskInput {
  title: string;
  status?: TaskStatusId;
  priority?: TaskPriorityId;
  description?: string;
  assigneeId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
  projectId?: string | null;
}

interface TasksState {
  tasks: Task[];
  members: TaskMember[];
  membersByProject: Record<string, TaskMember[]>;
  projects: TaskProject[];
  taskMode: TaskMode;
  selectedProjectId: string | null;
  isLoading: boolean;
  error: string | null;
  selectedTaskId: string | null;
  scope: TaskScope;

  setScope: (scope: TaskScope) => void;
  setProjectFilter: (projectId: string | null) => void;
  fetchProjects: () => Promise<void>;
  fetchTasks: () => Promise<void>;
  fetchMembers: (projectId?: string | null) => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<Task | null>;
  updateTask: (id: string, patch: Partial<Task> & { assigneeId?: string | null }) => Promise<void>;
  moveTask: (id: string, status: TaskStatusId) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  openTask: (id: string) => void;
  closeTask: () => void;
  clearError: () => void;
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json() as { message?: string };
    return body.message?.trim() || fallback;
  } catch {
    return fallback;
  }
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  members: [],
  membersByProject: {},
  projects: [],
  taskMode: "local",
  selectedProjectId: null,
  isLoading: true,
  error: null,
  selectedTaskId: null,
  scope: "all",

  openTask: (id) => set({ selectedTaskId: id }),
  closeTask: () => set({ selectedTaskId: null }),
  clearError: () => set({ error: null }),

  setScope: (scope) => {
    set({ scope });
    void get().fetchTasks();
  },

  setProjectFilter: (selectedProjectId) => {
    set({ selectedProjectId, selectedTaskId: null });
    void get().fetchTasks();
    if (selectedProjectId) void get().fetchMembers(selectedProjectId);
  },

  fetchProjects: async () => {
    try {
      const response = await fetch("/api/tasks/projects");
      if (!response.ok) {
        set({ error: await responseMessage(response, "Failed to load projects") });
        return;
      }
      const data = await response.json() as { mode?: TaskMode; projects?: TaskProject[] };
      const projects = Array.isArray(data.projects) ? data.projects : [];
      const selected = get().selectedProjectId;
      const taskMode = data.mode === "bi" ? "bi" : "local";
      set({
        taskMode,
        projects,
        selectedProjectId: selected && projects.some((project) => project.id === selected) ? selected : null,
        scope: taskMode === "bi" && get().scope === "team" ? "all" : get().scope,
      });
    } catch {
      set({ error: "Network error while loading projects" });
    }
  },

  fetchTasks: async () => {
    const requestId = ++taskRequestSequence;
    const scope = get().scope;
    const selectedProjectId = get().selectedProjectId;
    set({ isLoading: get().tasks.length === 0, error: null });
    try {
      const params = new URLSearchParams({ scope });
      if (selectedProjectId) params.set("projectId", selectedProjectId);
      const response = await fetch(`/api/tasks?${params.toString()}`);
      if (requestId !== taskRequestSequence) return;
      if (!response.ok) {
        const message = response.status === 401
          ? null
          : await responseMessage(response, "Failed to load tasks");
        if (requestId !== taskRequestSequence) return;
        set({
          isLoading: false,
          error: message,
        });
        return;
      }
      const data = await response.json() as { tasks?: Task[] };
      if (requestId !== taskRequestSequence) return;
      set({ tasks: Array.isArray(data.tasks) ? data.tasks : [], isLoading: false });
    } catch {
      if (requestId !== taskRequestSequence) return;
      set({ isLoading: false, error: "Network error while loading tasks" });
    }
  },

  fetchMembers: async (projectId = null) => {
    const mode = get().taskMode;
    const selectedProjectId = projectId ?? get().selectedProjectId;
    if (mode === "bi" && !selectedProjectId) return;

    const requestKey = `${mode}:${selectedProjectId ?? "all"}`;
    const pending = memberRequests.get(requestKey);
    if (pending) return pending;

    const request = (async () => {
      try {
        const params = new URLSearchParams();
        if (selectedProjectId) params.set("projectId", selectedProjectId);
        const suffix = params.size > 0 ? `?${params.toString()}` : "";
        const response = await fetch(`/api/tasks/members${suffix}`);
        if (!response.ok) {
          set({ error: await responseMessage(response, "Failed to load project members") });
          return;
        }
        const data = await response.json() as { members?: TaskMember[] };
        const members = Array.isArray(data.members) ? data.members : [];
        if (mode === "bi" && selectedProjectId) {
          set((state) => ({
            membersByProject: { ...state.membersByProject, [selectedProjectId]: members },
          }));
        } else {
          set({ members });
        }
      } catch {
        set({ error: "Network error while loading project members" });
      }
    })();

    memberRequests.set(requestKey, request);
    try {
      await request;
    } finally {
      if (memberRequests.get(requestKey) === request) memberRequests.delete(requestKey);
    }
  },

  createTask: async (input) => {
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        set({ error: await responseMessage(response, "Failed to create task") });
        return null;
      }
      const { task } = await response.json() as { task: Task };
      const selectedProjectId = get().selectedProjectId;
      if (!selectedProjectId || task.projectId === selectedProjectId) {
        set((state) => ({ tasks: [task, ...state.tasks], error: null }));
      }
      return task;
    } catch {
      set({ error: "Network error while creating task" });
      return null;
    }
  },

  updateTask: async (id, patch) => {
    const previous = get().tasks;
    set({ tasks: previous.map((task) => (task.id === id ? { ...task, ...patch } : task)), error: null });
    try {
      const response = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "Failed to update task"));
      const { task } = await response.json() as { task: Task };
      set((state) => ({ tasks: state.tasks.map((item) => (item.id === id ? task : item)) }));
    } catch (error) {
      set({ tasks: previous, error: error instanceof Error ? error.message : "Failed to update task" });
    }
  },

  moveTask: async (id, status) => {
    const previous = get().tasks;
    const target = previous.find((task) => task.id === id);
    if (!target || target.status === status) return;
    set({ tasks: previous.map((task) => (task.id === id ? { ...task, status } : task)), error: null });
    try {
      const response = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "Failed to move task"));
      const { task } = await response.json() as { task: Task };
      set((state) => ({ tasks: state.tasks.map((item) => (item.id === id ? task : item)) }));
    } catch (error) {
      set({ tasks: previous, error: error instanceof Error ? error.message : "Failed to move task" });
    }
  },

  deleteTask: async (id) => {
    const previous = get().tasks;
    set({
      tasks: previous.filter((task) => task.id !== id),
      selectedTaskId: get().selectedTaskId === id ? null : get().selectedTaskId,
      error: null,
    });
    try {
      const response = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await responseMessage(response, "Failed to delete task"));
    } catch (error) {
      set({ tasks: previous, error: error instanceof Error ? error.message : "Failed to delete task" });
    }
  },
}));
