"use client";

import { useMemo } from "react";
import { type Task } from "@/lib/tasks/constants";
import { useTasksStore } from "@/store/tasks-store";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { STATUS_COLOR, PRIORITY_DOT } from "./shared";

const DAY_MS = 24 * 60 * 60 * 1000;

// A task's span on the timeline runs from its created date to its due date.
// With no due date it renders as a single-day marker at its creation.
function taskSpan(task: Task): { start: Date; end: Date } {
  const start = new Date(task.createdAt);
  start.setHours(0, 0, 0, 0);
  const end = task.dueDate ? new Date(task.dueDate) : new Date(start);
  end.setHours(0, 0, 0, 0);
  // Guard against a due date earlier than creation (clamp to a 1-day bar).
  if (end < start) return { start, end: start };
  return { start, end };
}

export function TaskTimeline() {
  const { t } = useTranslation();
  const tasks = useTasksStore((s) => s.tasks);
  const openTask = useTasksStore((s) => s.openTask);

  const { rows, days, rangeStart } = useMemo(() => {
    if (tasks.length === 0) return { rows: [] as Task[], days: [] as Date[], rangeStart: new Date() };

    let min = Infinity;
    let max = -Infinity;
    for (const task of tasks) {
      const { start, end } = taskSpan(task);
      min = Math.min(min, start.getTime());
      max = Math.max(max, end.getTime());
    }
    // Pad the range by 2 days on each side for breathing room.
    const startD = new Date(min - 2 * DAY_MS);
    startD.setHours(0, 0, 0, 0);
    const endD = new Date(max + 2 * DAY_MS);
    const dayCount = Math.max(1, Math.round((endD.getTime() - startD.getTime()) / DAY_MS) + 1);
    const dayArr = Array.from({ length: dayCount }, (_, i) => new Date(startD.getTime() + i * DAY_MS));

    // Sort tasks by start date so bars read top-to-bottom chronologically.
    const sorted = [...tasks].sort((a, b) => taskSpan(a).start.getTime() - taskSpan(b).start.getTime());
    return { rows: sorted, days: dayArr, rangeStart: startD };
  }, [tasks]);

  const COL = 34; // px per day column

  if (tasks.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">{t("tasks.emptyGroup")}</div>;
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="min-w-max">
        {/* Day header */}
        <div className="flex sticky top-0 z-10 bg-background border-b border-border">
          <div className="w-56 shrink-0 border-r border-border px-3 py-2 text-[11px] font-medium text-muted-foreground">
            {t("tasks.title")}
          </div>
          <div className="flex">
            {days.map((d) => {
              const isMonthStart = d.getDate() === 1;
              return (
                <div
                  key={d.getTime()}
                  className={cn("shrink-0 text-center py-1 border-r border-border/40", isMonthStart && "border-border")}
                  style={{ width: COL }}
                >
                  {isMonthStart && (
                    <div className="text-[9px] font-semibold text-muted-foreground">
                      {d.toLocaleDateString(undefined, { month: "short" })}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground tabular-nums">{d.getDate()}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Rows */}
        {rows.map((task) => {
          const { start, end } = taskSpan(task);
          const offset = Math.round((start.getTime() - rangeStart.getTime()) / DAY_MS);
          const length = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1);
          return (
            <div key={task.id} className="flex items-center border-b border-border/40 hover:bg-muted/30">
              <button
                onClick={() => openTask(task.id)}
                className="w-56 shrink-0 border-r border-border px-3 py-2 flex items-center gap-2 min-w-0 text-left hover:bg-muted/40 transition-colors"
              >
                <span className={cn("size-2 rounded-full shrink-0", PRIORITY_DOT[task.priority])} />
                <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">{task.identifier}</span>
                <span className="text-sm truncate">{task.title}</span>
              </button>
              <div className="relative py-2" style={{ width: days.length * COL, height: 36 }}>
                <button
                  onClick={() => openTask(task.id)}
                  className="absolute top-1/2 -translate-y-1/2 h-5 rounded-md flex items-center px-2 text-[10px] text-white/95 truncate shadow-sm hover:brightness-110 transition-all cursor-pointer"
                  style={{ left: offset * COL + 2, width: length * COL - 4, backgroundColor: STATUS_COLOR[task.status] }}
                  title={task.title}
                >
                  <span className="truncate">{task.title}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
