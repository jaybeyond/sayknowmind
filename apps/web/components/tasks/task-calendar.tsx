"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { type Task } from "@/lib/tasks/constants";
import { useTasksStore } from "@/store/tasks-store";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { STATUS_COLOR, dateKey } from "./shared";

// Build the 6-week (42-cell) grid that contains the given month, starting on
// Sunday — the standard month view. Pure date math, no date-fns.
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function TaskCalendar() {
  const { t } = useTranslation();
  const tasks = useTasksStore((s) => s.tasks);
  const openTask = useTasksStore((s) => s.openTask);
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() };
  });

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.dueDate) continue;
      const key = dateKey(new Date(task.dueDate));
      const bucket = map.get(key);
      if (bucket) bucket.push(task);
      else map.set(key, [task]);
    }
    return map;
  }, [tasks]);

  const unscheduled = useMemo(() => tasks.filter((t) => !t.dueDate), [tasks]);
  const cells = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const todayKey = dateKey(new Date());
  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const weekdays = useMemo(() => {
    // Localized short weekday names, Sun→Sat.
    return Array.from({ length: 7 }, (_, i) => new Date(2023, 0, i + 1).toLocaleDateString(undefined, { weekday: "short" }));
  }, []);

  const shift = (delta: number) => {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-border">
        <button onClick={() => shift(-1)} className="p-1 rounded hover:bg-muted"><ChevronLeft className="size-4" /></button>
        <h3 className="text-sm font-semibold min-w-40 text-center">{monthLabel}</h3>
        <button onClick={() => shift(1)} className="p-1 rounded hover:bg-muted"><ChevronRight className="size-4" /></button>
        <button
          onClick={() => { const n = new Date(); setCursor({ year: n.getFullYear(), month: n.getMonth() }); }}
          className="ml-2 text-xs px-2 py-1 rounded-md border border-border hover:bg-muted"
        >
          {t("tasks.today")}
        </button>
        {unscheduled.length > 0 && (
          <span className="ml-auto text-xs text-muted-foreground">
            {t("tasks.unscheduledCount").replace("{{count}}", String(unscheduled.length))}
          </span>
        )}
      </div>

      <div className="grid grid-cols-7 border-b border-border">
        {weekdays.map((w) => (
          <div key={w} className="px-2 py-1.5 text-[11px] font-medium text-muted-foreground text-center">{w}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 grid-rows-6 flex-1 overflow-y-auto">
        {cells.map((day) => {
          const key = dateKey(day);
          const inMonth = day.getMonth() === cursor.month;
          const dayTasks = byDay.get(key) ?? [];
          return (
            <div
              key={key}
              className={cn(
                "border-b border-r border-border/60 p-1 min-h-20 flex flex-col gap-1 overflow-hidden",
                !inMonth && "bg-muted/20",
              )}
            >
              <span
                className={cn(
                  "text-[11px] tabular-nums self-start px-1 rounded",
                  key === todayKey ? "bg-primary text-primary-foreground font-semibold" : inMonth ? "text-foreground" : "text-muted-foreground/50",
                )}
              >
                {day.getDate()}
              </span>
              {dayTasks.slice(0, 3).map((task) => (
                <button
                  key={task.id}
                  onClick={() => openTask(task.id)}
                  className="flex items-center gap-1 text-[10px] rounded px-1 py-0.5 bg-muted/60 hover:bg-muted truncate w-full text-left transition-colors"
                  title={task.title}
                >
                  <span className="size-1.5 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLOR[task.status] }} />
                  <span className="truncate">{task.title}</span>
                </button>
              ))}
              {dayTasks.length > 3 && (
                <span className="text-[10px] text-muted-foreground px-1">+{dayTasks.length - 3}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
