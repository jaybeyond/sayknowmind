import { TASK_STATUSES, TASK_PRIORITIES } from "@/lib/tasks/constants";

/** Tailwind bg class for a priority dot, keyed by priority id. */
export const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-sky-500",
  "no-priority": "bg-muted-foreground/30",
};

export const STATUS_COLOR: Record<string, string> = Object.fromEntries(
  TASK_STATUSES.map((s) => [s.id, s.color]),
);

export const STATUS_LABEL_KEY: Record<string, string> = Object.fromEntries(
  TASK_STATUSES.map((s) => [s.id, s.labelKey]),
);

export const PRIORITY_LABEL_KEY: Record<string, string> = Object.fromEntries(
  TASK_PRIORITIES.map((p) => [p.id, p.labelKey]),
);

/** Two-letter avatar initials from a name or email. */
export function initials(name: string | null, email: string | null): string {
  return (name || email || "?").trim().slice(0, 2).toUpperCase();
}

/** Local YYYY-MM-DD key for a Date (avoids UTC off-by-one from toISOString). */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Whether a due date is before today and the task isn't done. */
export function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date(new Date().toDateString()) && status !== "completed";
}
