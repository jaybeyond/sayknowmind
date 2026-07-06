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

/** Whether a due date is before now and the task isn't done. */
export function isOverdue(dueDate: string | null, status: string): boolean {
  if (!dueDate) return false;
  return new Date(dueDate).getTime() < Date.now() && status !== "completed";
}

/** ISO instant → value for <input type="datetime-local"> (local tz, no seconds). */
export function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value → ISO instant, or null when cleared. */
export function fromDatetimeLocal(v: string): string | null {
  if (!v) return null;
  const d = new Date(v); // parsed as local time
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Compact "Mar 5, 15:00" label (omits time at midnight). */
export function formatDue(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (d.getHours() === 0 && d.getMinutes() === 0) return date;
  return `${date}, ${d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}
