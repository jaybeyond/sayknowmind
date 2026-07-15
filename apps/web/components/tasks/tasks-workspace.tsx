"use client";

import { useEffect, useState } from "react";
import { SquareKanban, List, CalendarDays, GanttChartSquare, FolderKanban, X } from "lucide-react";
import { useTasksStore, type TaskScope } from "@/store/tasks-store";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { TaskBoard } from "./task-board";
import { TaskList } from "./task-list";
import { TaskCalendar } from "./task-calendar";
import { TaskTimeline } from "./task-timeline";
import { TaskDetailSheet } from "./task-detail-sheet";
import { PresenceBar } from "./presence-bar";

type ViewId = "board" | "list" | "calendar" | "timeline";

const VIEWS: { id: ViewId; icon: typeof List; labelKey: string }[] = [
  { id: "board", icon: SquareKanban, labelKey: "tasks.view.board" },
  { id: "list", icon: List, labelKey: "tasks.view.list" },
  { id: "calendar", icon: CalendarDays, labelKey: "tasks.view.calendar" },
  { id: "timeline", icon: GanttChartSquare, labelKey: "tasks.view.timeline" },
];

const VIEW_STORAGE_KEY = "skm.tasks.view";

const SCOPES: { id: TaskScope; labelKey: string }[] = [
  { id: "all", labelKey: "tasks.scope.all" },
  { id: "personal", labelKey: "tasks.scope.personal" },
  { id: "team", labelKey: "tasks.scope.team" },
];

/**
 * Owns the Tasks feature shell: fetches tasks + members once, renders the
 * view switcher, and swaps between the board/list/calendar/timeline views —
 * all reading the same store, so switching views is instant with no refetch.
 */
export function TasksWorkspace() {
  const { t } = useTranslation();
  const fetchProjects = useTasksStore((s) => s.fetchProjects);
  const scope = useTasksStore((s) => s.scope);
  const setScope = useTasksStore((s) => s.setScope);
  const taskMode = useTasksStore((s) => s.taskMode);
  const projects = useTasksStore((s) => s.projects);
  const selectedProjectId = useTasksStore((s) => s.selectedProjectId);
  const setProjectFilter = useTasksStore((s) => s.setProjectFilter);
  const error = useTasksStore((s) => s.error);
  const clearError = useTasksStore((s) => s.clearError);
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
    void fetchProjects().then(() => {
      const state = useTasksStore.getState();
      void state.fetchTasks();
      if (state.taskMode === "local") void state.fetchMembers();
      else if (state.selectedProjectId) void state.fetchMembers(state.selectedProjectId);
    });
  }, [fetchProjects]);

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
      {/* View switcher + presence */}
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
        {taskMode === "bi" && (
          <label className="ml-auto flex min-w-0 items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground">
            <FolderKanban className="size-3.5 shrink-0" />
            <span className="sr-only">{t("tasks.project")}</span>
            <select
              value={selectedProjectId ?? ""}
              onChange={(event) => setProjectFilter(event.target.value || null)}
              className="min-w-24 max-w-48 bg-transparent text-foreground outline-none"
            >
              <option value="">{t("tasks.allProjects")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
        )}
        <div className={cn("flex items-center gap-1 rounded-md border border-border p-0.5", taskMode !== "bi" && "ml-auto")}>
          {SCOPES.filter((item) => taskMode !== "bi" || item.id !== "team").map((s) => (
            <button
              key={s.id}
              onClick={() => setScope(s.id)}
              className={cn(
                "px-2 py-1 rounded text-xs font-medium transition-colors",
                scope === s.id ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(s.labelKey)}
            </button>
          ))}
        </div>
        <PresenceBar />
      </div>

      {error && (
        <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs text-destructive">
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <button onClick={clearError} className="shrink-0 rounded p-0.5 hover:bg-destructive/10" title={t("tasks.dismissError")}>
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {view === "board" && <TaskBoard />}
      {view === "list" && <TaskList />}
      {view === "calendar" && <TaskCalendar />}
      {view === "timeline" && <TaskTimeline />}

      <TaskDetailSheet />
    </div>
  );
}
