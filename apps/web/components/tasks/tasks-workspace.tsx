"use client";

import { useEffect, useState } from "react";
import { SquareKanban, List, CalendarDays, GanttChartSquare } from "lucide-react";
import { useTasksStore } from "@/store/tasks-store";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { TaskBoard } from "./task-board";
import { TaskList } from "./task-list";
import { TaskCalendar } from "./task-calendar";
import { TaskTimeline } from "./task-timeline";

type ViewId = "board" | "list" | "calendar" | "timeline";

const VIEWS: { id: ViewId; icon: typeof List; labelKey: string }[] = [
  { id: "board", icon: SquareKanban, labelKey: "tasks.view.board" },
  { id: "list", icon: List, labelKey: "tasks.view.list" },
  { id: "calendar", icon: CalendarDays, labelKey: "tasks.view.calendar" },
  { id: "timeline", icon: GanttChartSquare, labelKey: "tasks.view.timeline" },
];

const VIEW_STORAGE_KEY = "skm.tasks.view";

/**
 * Owns the Tasks feature shell: fetches tasks + members once, renders the
 * view switcher, and swaps between the board/list/calendar/timeline views —
 * all reading the same store, so switching views is instant with no refetch.
 */
export function TasksWorkspace() {
  const { t } = useTranslation();
  const fetchTasks = useTasksStore((s) => s.fetchTasks);
  const fetchMembers = useTasksStore((s) => s.fetchMembers);
  const [view, setView] = useState<ViewId>("board");

  // Restore the last-used view. Done in an effect (not a lazy useState init)
  // on purpose: this component server-renders, and reading localStorage during
  // init would diverge from the server's "board" and trip hydration. The
  // one-time post-mount setState is the intended pattern here.
  useEffect(() => {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(VIEW_STORAGE_KEY) : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only preference restore, see note above
    if (saved && VIEWS.some((v) => v.id === saved)) setView(saved as ViewId);
  }, []);

  useEffect(() => {
    fetchTasks();
    fetchMembers();
  }, [fetchTasks, fetchMembers]);

  const selectView = (id: ViewId) => {
    setView(id);
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* View switcher */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-border">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            onClick={() => selectView(v.id)}
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors",
              view === v.id ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <v.icon className="size-4" />
            <span className="hidden sm:inline">{t(v.labelKey)}</span>
          </button>
        ))}
      </div>

      {view === "board" && <TaskBoard />}
      {view === "list" && <TaskList />}
      {view === "calendar" && <TaskCalendar />}
      {view === "timeline" && <TaskTimeline />}
    </div>
  );
}
