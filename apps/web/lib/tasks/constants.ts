/**
 * Task-management domain constants, shared by the API and UI so a status or
 * priority is validated the same way everywhere. Status/priority sets are fixed
 * (adapted from ln-dev7/circle) and stored as plain strings on `work_items`.
 */

export type TaskStatusId =
  | "backlog"
  | "todo"
  | "in-progress"
  | "technical-review"
  | "completed"
  | "paused";

export type TaskPriorityId = "no-priority" | "urgent" | "high" | "medium" | "low";

export interface TaskStatusMeta {
  id: TaskStatusId;
  /** i18n key for the display label. */
  labelKey: string;
  color: string;
}

export interface TaskPriorityMeta {
  id: TaskPriorityId;
  labelKey: string;
  /** Sort weight — urgent first, no-priority last. */
  weight: number;
}

// Board column order, left → right (backlog → done, paused parked at the end).
export const TASK_STATUSES: TaskStatusMeta[] = [
  { id: "backlog", labelKey: "tasks.status.backlog", color: "#ec4899" },
  { id: "todo", labelKey: "tasks.status.todo", color: "#f97316" },
  { id: "in-progress", labelKey: "tasks.status.inProgress", color: "#facc15" },
  { id: "technical-review", labelKey: "tasks.status.review", color: "#22c55e" },
  { id: "completed", labelKey: "tasks.status.completed", color: "#8b5cf6" },
  { id: "paused", labelKey: "tasks.status.paused", color: "#0ea5e9" },
];

export const TASK_PRIORITIES: TaskPriorityMeta[] = [
  { id: "urgent", labelKey: "tasks.priority.urgent", weight: 0 },
  { id: "high", labelKey: "tasks.priority.high", weight: 1 },
  { id: "medium", labelKey: "tasks.priority.medium", weight: 2 },
  { id: "low", labelKey: "tasks.priority.low", weight: 3 },
  { id: "no-priority", labelKey: "tasks.priority.none", weight: 4 },
];

const STATUS_IDS = new Set(TASK_STATUSES.map((s) => s.id));
const PRIORITY_IDS = new Set(TASK_PRIORITIES.map((p) => p.id));

export function isValidStatus(v: unknown): v is TaskStatusId {
  return typeof v === "string" && STATUS_IDS.has(v as TaskStatusId);
}
export function isValidPriority(v: unknown): v is TaskPriorityId {
  return typeof v === "string" && PRIORITY_IDS.has(v as TaskPriorityId);
}

/** A status is "done" (sets completed_at) only when it reaches completed. */
export function isDoneStatus(status: string): boolean {
  return status === "completed";
}

export interface TaskLabel {
  id: string;
  name: string;
  color: string;
}

export interface Task {
  id: string;
  identifier: string | null;
  title: string;
  description: string | null;
  status: TaskStatusId;
  priority: TaskPriorityId;
  assignee: { id: string; name: string | null; email: string | null; image: string | null } | null;
  labels: TaskLabel[];
  rank: string | null;
  startDate: string | null;
  dueDate: string | null;
  documentId: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
