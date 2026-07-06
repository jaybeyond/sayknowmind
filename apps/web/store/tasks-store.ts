import { create } from "zustand";
import type { Task, TaskStatusId, TaskPriorityId } from "@/lib/tasks/constants";

/** Which slice of tasks the board shows: personal org, team orgs, or all. */
export type TaskScope = "all" | "personal" | "team";

export interface TaskMember {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

interface CreateTaskInput {
  title: string;
  status?: TaskStatusId;
  priority?: TaskPriorityId;
  description?: string;
  assigneeId?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
}

interface TasksState {
  tasks: Task[];
  members: TaskMember[];
  isLoading: boolean;
  error: string | null;
  /** Task open in the detail sheet (edit from any view), or null. */
  selectedTaskId: string | null;
  /** Personal / team / all scope filter for the board. */
  scope: TaskScope;

  setScope: (scope: TaskScope) => void;
  fetchTasks: () => Promise<void>;
  fetchMembers: () => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<Task | null>;
  updateTask: (id: string, patch: Partial<Task> & { assigneeId?: string | null }) => Promise<void>;
  /** Optimistic status move (drag-and-drop between board columns). */
  moveTask: (id: string, status: TaskStatusId) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  openTask: (id: string) => void;
  closeTask: () => void;
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: [],
  members: [],
  isLoading: true,
  error: null,
  selectedTaskId: null,
  scope: "all",

  openTask: (id) => set({ selectedTaskId: id }),
  closeTask: () => set({ selectedTaskId: null }),

  setScope: (scope) => {
    set({ scope });
    void get().fetchTasks();
  },

  fetchTasks: async () => {
    set({ isLoading: get().tasks.length === 0, error: null });
    try {
      const res = await fetch(`/api/tasks?scope=${get().scope}`);
      if (!res.ok) {
        set({ isLoading: false, error: res.status === 401 ? null : "Failed to load tasks" });
        return;
      }
      const data = await res.json();
      set({ tasks: Array.isArray(data.tasks) ? data.tasks : [], isLoading: false });
    } catch {
      set({ isLoading: false, error: "Network error" });
    }
  },

  fetchMembers: async () => {
    try {
      const res = await fetch("/api/tasks/members");
      if (!res.ok) return;
      const data = await res.json();
      set({ members: Array.isArray(data.members) ? data.members : [] });
    } catch {
      /* non-fatal — assignee picker just shows empty */
    }
  },

  createTask: async (input) => {
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) return null;
      const { task } = (await res.json()) as { task: Task };
      set((s) => ({ tasks: [task, ...s.tasks] }));
      return task;
    } catch {
      return null;
    }
  },

  updateTask: async (id, patch) => {
    const prev = get().tasks;
    // Optimistic: apply the patch locally, roll back on failure.
    set({ tasks: prev.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("update failed");
      const { task } = (await res.json()) as { task: Task };
      set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? task : t)) }));
    } catch {
      set({ tasks: prev });
    }
  },

  moveTask: async (id, status) => {
    const prev = get().tasks;
    const target = prev.find((t) => t.id === id);
    if (!target || target.status === status) return;
    set({ tasks: prev.map((t) => (t.id === id ? { ...t, status } : t)) });
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error("move failed");
      const { task } = (await res.json()) as { task: Task };
      set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? task : t)) }));
    } catch {
      set({ tasks: prev });
    }
  },

  deleteTask: async (id) => {
    const prev = get().tasks;
    set({
      tasks: prev.filter((t) => t.id !== id),
      selectedTaskId: get().selectedTaskId === id ? null : get().selectedTaskId,
    });
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
    } catch {
      set({ tasks: prev });
    }
  },
}));
