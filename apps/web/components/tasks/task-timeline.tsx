"use client";

import { useMemo, useRef, useState } from "react";
import { type Task } from "@/lib/tasks/constants";
import { useTasksStore } from "@/store/tasks-store";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { STATUS_COLOR, PRIORITY_DOT, formatDue } from "./shared";

const DAY_MS = 24 * 60 * 60 * 1000;
const COL = 34; // px per day column
const DRAG_THRESHOLD = 4; // px of movement before a press counts as a drag, not a click
const EDGE = 8; // px hit-zone at each end for resize (vs. move in the middle)

type DragMode = "move" | "resize-start" | "resize-end";

// A task's span runs from its start date (or created date if unset) to its due
// date. With no due date it renders as a single-day marker at the start.
function taskSpan(task: Task): { start: Date; end: Date } {
  const start = new Date(task.startDate ?? task.createdAt);
  start.setHours(0, 0, 0, 0);
  const end = task.dueDate ? new Date(task.dueDate) : new Date(start);
  end.setHours(0, 0, 0, 0);
  if (end < start) return { start, end: start };
  return { start, end };
}

/** ISO after shifting a base instant (or fallback) by whole days. */
function shift(base: string | null, fallback: string, deltaDays: number): string {
  const d = new Date(base ?? fallback);
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString();
}

/**
 * One timeline row's bar with Gantt gestures:
 *   • grab the MIDDLE → move the whole bar (shift start + due together)
 *   • grab the LEFT edge → change the start date (resize left)
 *   • grab the RIGHT edge → change the due date (resize right / extend)
 * A press that barely moves is a click → opens the detail sheet. Live preview
 * follows the cursor; the commit snaps to whole days.
 */
function TimelineBar({ task, offset, length }: { task: Task; offset: number; length: number }) {
  const updateTask = useTasksStore((s) => s.updateTask);
  const openTask = useTasksStore((s) => s.openTask);
  const [dragDX, setDragDX] = useState<number | null>(null);
  const [dragMode, setDragMode] = useState<DragMode>("move");
  const startXRef = useRef(0);

  const baseWidth = length * COL - 4;
  const baseLeft = offset * COL + 2;
  const rawDelta = dragDX == null ? 0 : Math.round(dragDX / COL);

  // Per-mode clamped day delta (keeps start <= end, min 1-day span).
  let deltaDays = rawDelta;
  if (dragMode === "resize-start") deltaDays = Math.min(rawDelta, length - 1);
  else if (dragMode === "resize-end") deltaDays = Math.max(rawDelta, -(length - 1));

  // Preview geometry.
  let left = baseLeft;
  let width = baseWidth;
  if (dragMode === "move") left = baseLeft + deltaDays * COL;
  else if (dragMode === "resize-start") { left = baseLeft + deltaDays * COL; width = baseWidth - deltaDays * COL; }
  else width = baseWidth + deltaDays * COL;

  const dragging = dragDX != null && Math.abs(dragDX) >= DRAG_THRESHOLD;

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    setDragMode(localX < EDGE ? "resize-start" : localX > rect.width - EDGE ? "resize-end" : "move");
    startXRef.current = e.clientX;
    setDragDX(0);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragDX == null) return;
    setDragDX(e.clientX - startXRef.current);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragDX == null) return;
    const moved = Math.abs(dragDX);
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    const delta = deltaDays;
    setDragDX(null);
    if (moved < DRAG_THRESHOLD) { openTask(task.id); return; }
    if (delta === 0) return;
    if (dragMode === "move") {
      updateTask(task.id, {
        startDate: shift(task.startDate, task.createdAt, delta),
        dueDate: shift(task.dueDate, task.startDate ?? task.createdAt, delta),
      });
    } else if (dragMode === "resize-start") {
      updateTask(task.id, { startDate: shift(task.startDate, task.createdAt, delta) });
    } else {
      updateTask(task.id, { dueDate: shift(task.dueDate, task.startDate ?? task.createdAt, delta) });
    }
  };

  // Preview label: show the moving date(s) while dragging.
  let previewLabel: string | null = null;
  if (dragging) {
    if (dragMode === "resize-start") previewLabel = formatDue(shift(task.startDate, task.createdAt, deltaDays));
    else previewLabel = formatDue(shift(task.dueDate, task.startDate ?? task.createdAt, deltaDays));
  }

  return (
    <div className="relative py-2" style={{ width: "100%", height: 36 }}>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="button"
        tabIndex={0}
        className={cn(
          "group/bar absolute top-1/2 -translate-y-1/2 h-5 rounded-md flex items-center px-2 text-[10px] text-white/95 truncate shadow-sm select-none touch-none",
          dragging ? "cursor-grabbing ring-2 ring-white/40" : "cursor-grab hover:brightness-110",
        )}
        style={{ left, width: Math.max(COL - 4, width), backgroundColor: STATUS_COLOR[task.status] }}
        title={task.title}
      >
        {/* Edge resize affordances (visual only; hit-testing is by localX). */}
        <span className="absolute left-0 top-0 h-full w-2 rounded-l-md cursor-ew-resize opacity-0 group-hover/bar:opacity-100 bg-white/25" />
        <span className="absolute right-0 top-0 h-full w-2 rounded-r-md cursor-ew-resize opacity-0 group-hover/bar:opacity-100 bg-white/25" />
        <span className="truncate">{task.title}</span>
      </div>
      {previewLabel && (
        <span
          className="absolute -top-0.5 text-[9px] font-medium text-foreground bg-background/90 rounded px-1 shadow-sm pointer-events-none"
          style={{ left: left + Math.max(COL - 4, width) + 4 }}
        >
          {previewLabel}
        </span>
      )}
    </div>
  );
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
    const startD = new Date(min - 2 * DAY_MS);
    startD.setHours(0, 0, 0, 0);
    const endD = new Date(max + 2 * DAY_MS);
    const dayCount = Math.max(1, Math.round((endD.getTime() - startD.getTime()) / DAY_MS) + 1);
    const dayArr = Array.from({ length: dayCount }, (_, i) => new Date(startD.getTime() + i * DAY_MS));

    const sorted = [...tasks].sort((a, b) => taskSpan(a).start.getTime() - taskSpan(b).start.getTime());
    return { rows: sorted, days: dayArr, rangeStart: startD };
  }, [tasks]);

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
              <div className="relative" style={{ width: days.length * COL }}>
                <TimelineBar task={task} offset={offset} length={length} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
