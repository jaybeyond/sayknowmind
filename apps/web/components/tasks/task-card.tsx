"use client";

import { useEffect } from "react";
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
import { FolderKanban, MoreHorizontal, Trash2 } from "lucide-react";
import {
  BI_TASK_PRIORITIES,
  BI_TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Task,
} from "@/lib/tasks/constants";
import { EMPTY_TASK_MEMBERS, useTasksStore } from "@/store/tasks-store";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PRIORITY_DOT, initials } from "./shared";
import { DueDateField } from "./due-date-field";

export function TaskCard({ task, onDragStart }: { task: Task; onDragStart: (id: string) => void }) {
  const { t } = useTranslation();
  const updateTask = useTasksStore((s) => s.updateTask);
  const deleteTask = useTasksStore((s) => s.deleteTask);
  const members = useTasksStore((s) => task.projectId
    ? s.membersByProject[task.projectId] ?? EMPTY_TASK_MEMBERS
    : s.members);
  const fetchMembers = useTasksStore((s) => s.fetchMembers);
  const taskMode = useTasksStore((s) => s.taskMode);
  const openTask = useTasksStore((s) => s.openTask);
  const statuses = taskMode === "bi" ? BI_TASK_STATUSES : TASK_STATUSES;
  const priorities = taskMode === "bi" ? BI_TASK_PRIORITIES : TASK_PRIORITIES;

  useEffect(() => {
    if (task.projectId && members.length === 0) void fetchMembers(task.projectId);
  }, [fetchMembers, members.length, task.projectId]);

  const priority = TASK_PRIORITIES.find((p) => p.id === task.priority);

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
                {priorities.map((p) => (
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
                {statuses.map((s) => (
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
                {taskMode !== "bi" && (
                  <DropdownMenuItem onClick={() => updateTask(task.id, { assigneeId: null, assignee: null })}>
                    {t("tasks.unassigned")}
                  </DropdownMenuItem>
                )}
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

      <button
        onClick={() => openTask(task.id)}
        className="mt-1.5 text-sm leading-snug line-clamp-3 text-left w-full hover:text-primary transition-colors"
      >
        {task.title}
      </button>

      {task.project && (
        <div className="mt-2 flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground">
          <FolderKanban className="size-3 shrink-0" />
          <span className="truncate">{task.project.name}</span>
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {task.labels.slice(0, 1).map((l) => (
            <span
              key={l.id}
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border border-border"
            >
              <span className="size-1.5 rounded-full" style={{ backgroundColor: l.color }} />
              <span className="truncate max-w-16">{l.name}</span>
            </span>
          ))}
          <DueDateField
            value={task.dueDate}
            status={task.status}
            size="xs"
            onChange={(iso) => updateTask(task.id, { dueDate: iso })}
          />
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
