"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Trash2, CalendarDays } from "lucide-react";
import { TASK_PRIORITIES, TASK_STATUSES, type Task } from "@/lib/tasks/constants";
import { useTasksStore } from "@/store/tasks-store";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const PRIORITY_DOT: Record<string, string> = {
  urgent: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-500",
  low: "bg-sky-500",
  "no-priority": "bg-muted-foreground/30",
};

function initials(name: string | null, email: string | null): string {
  const src = (name || email || "?").trim();
  return src.slice(0, 2).toUpperCase();
}

export function TaskCard({ task, onDragStart }: { task: Task; onDragStart: (id: string) => void }) {
  const { t } = useTranslation();
  const updateTask = useTasksStore((s) => s.updateTask);
  const deleteTask = useTasksStore((s) => s.deleteTask);
  const members = useTasksStore((s) => s.members);

  const priority = TASK_PRIORITIES.find((p) => p.id === task.priority);
  const due = task.dueDate ? new Date(task.dueDate) : null;
  const overdue = due ? due < new Date(new Date().toDateString()) && task.status !== "completed" : false;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", task.id);
        onDragStart(task.id);
      }}
      className="group/card rounded-lg border border-border bg-background p-3 shadow-xs cursor-grab active:cursor-grabbing hover:border-primary/40 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={cn("size-2 rounded-full shrink-0", PRIORITY_DOT[task.priority])} title={priority ? t(priority.labelKey) : ""} />
          <span className="text-[10px] font-medium text-muted-foreground tabular-nums truncate">
            {task.identifier}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="opacity-0 group-hover/card:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity shrink-0">
              <MoreHorizontal className="size-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t("tasks.setPriority")}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {TASK_PRIORITIES.map((p) => (
                  <DropdownMenuItem key={p.id} onClick={() => updateTask(task.id, { priority: p.id })}>
                    <span className={cn("size-2 rounded-full mr-2", PRIORITY_DOT[p.id])} />
                    {t(p.labelKey)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t("tasks.setStatus")}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {TASK_STATUSES.map((s) => (
                  <DropdownMenuItem key={s.id} onClick={() => updateTask(task.id, { status: s.id })}>
                    <span className="size-2 rounded-full mr-2" style={{ backgroundColor: s.color }} />
                    {t(s.labelKey)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t("tasks.assign")}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
                <DropdownMenuItem onClick={() => updateTask(task.id, { assigneeId: null, assignee: null })}>
                  {t("tasks.unassigned")}
                </DropdownMenuItem>
                {members.map((m) => (
                  <DropdownMenuItem
                    key={m.id}
                    onClick={() =>
                      updateTask(task.id, { assigneeId: m.id, assignee: m })
                    }
                  >
                    {m.name || m.email}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={() => deleteTask(task.id)}>
              <Trash2 className="size-3.5 mr-2" />
              {t("tasks.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p className="mt-1.5 text-sm leading-snug line-clamp-3">{task.title}</p>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {task.labels.slice(0, 2).map((l) => (
            <span
              key={l.id}
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border border-border"
            >
              <span className="size-1.5 rounded-full" style={{ backgroundColor: l.color }} />
              <span className="truncate max-w-16">{l.name}</span>
            </span>
          ))}
          {due && (
            <span className={cn("inline-flex items-center gap-1 text-[10px]", overdue ? "text-destructive" : "text-muted-foreground")}>
              <CalendarDays className="size-3" />
              {due.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          )}
        </div>
        {task.assignee && (
          <Avatar className="size-5 shrink-0">
            {task.assignee.image && <AvatarImage src={task.assignee.image} alt="" />}
            <AvatarFallback className="text-[9px]">
              {initials(task.assignee.name, task.assignee.email)}
            </AvatarFallback>
          </Avatar>
        )}
      </div>
    </div>
  );
}
