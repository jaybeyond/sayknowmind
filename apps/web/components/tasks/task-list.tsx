"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Plus, Trash2 } from "lucide-react";
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
import { TASK_STATUSES, TASK_PRIORITIES, type Task, type TaskStatusId } from "@/lib/tasks/constants";
import { useTasksStore } from "@/store/tasks-store";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PRIORITY_DOT, initials } from "./shared";
import { DueDateField } from "./due-date-field";

function TaskRow({ task }: { task: Task }) {
  const { t } = useTranslation();
  const updateTask = useTasksStore((s) => s.updateTask);
  const deleteTask = useTasksStore((s) => s.deleteTask);
  const members = useTasksStore((s) => s.members);
  const openTask = useTasksStore((s) => s.openTask);

  return (
    <div className="group/row flex items-center gap-3 px-3 py-2 border-b border-border/60 hover:bg-muted/40 transition-colors">
      <span className={cn("size-2 rounded-full shrink-0", PRIORITY_DOT[task.priority])} />
      <span className="text-[11px] font-medium text-muted-foreground tabular-nums w-16 shrink-0 truncate">
        {task.identifier}
      </span>
      <button onClick={() => openTask(task.id)} className="flex-1 text-sm truncate text-left hover:text-primary transition-colors">
        {task.title}
      </button>
      <span className="shrink-0">
        <DueDateField value={task.dueDate} status={task.status} onChange={(iso) => updateTask(task.id, { dueDate: iso })} />
      </span>
      {task.assignee ? (
        <Avatar className="size-5 shrink-0">
          {task.assignee.image && <AvatarImage src={task.assignee.image} alt="" />}
          <AvatarFallback className="text-[9px]">{initials(task.assignee.name, task.assignee.email)}</AvatarFallback>
        </Avatar>
      ) : (
        <span className="size-5 shrink-0 rounded-full border border-dashed border-border" />
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="opacity-0 group-hover/row:opacity-100 p-0.5 rounded hover:bg-muted transition-opacity shrink-0 text-muted-foreground">
            ⋯
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
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
            <DropdownMenuSubTrigger>{t("tasks.assign")}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-64 overflow-y-auto">
              <DropdownMenuItem onClick={() => updateTask(task.id, { assigneeId: null, assignee: null })}>
                {t("tasks.unassigned")}
              </DropdownMenuItem>
              {members.map((m) => (
                <DropdownMenuItem key={m.id} onClick={() => updateTask(task.id, { assigneeId: m.id, assignee: m })}>
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
  );
}

function StatusGroup({ status, tasks }: { status: (typeof TASK_STATUSES)[number]; tasks: Task[] }) {
  const { t } = useTranslation();
  const createTask = useTasksStore((s) => s.createTask);
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = title.trim();
    setTitle("");
    setDueDate(null);
    setAdding(false);
    if (trimmed) await createTask({ title: trimmed, status: status.id, dueDate });
  };

  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/50 sticky top-0 z-10">
        <button onClick={() => setOpen(!open)} className="flex items-center gap-2 flex-1 cursor-pointer">
          <ChevronDown className={cn("size-3.5 transition-transform text-muted-foreground", !open && "-rotate-90")} />
          <span className="size-2.5 rounded-full" style={{ backgroundColor: status.color }} />
          <span className="text-sm font-semibold">{t(status.labelKey)}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{tasks.length}</span>
        </button>
        <button onClick={() => { setAdding(true); setOpen(true); }} className="p-0.5 rounded hover:bg-muted text-muted-foreground">
          <Plus className="size-4" />
        </button>
      </div>
      {open && (
        <>
          {adding && (
            <div
              className="px-3 py-2 border-b border-border/60 flex items-center gap-3"
              onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) void submit(); }}
            >
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submit();
                  else if (e.key === "Escape") { setAdding(false); setTitle(""); setDueDate(null); }
                }}
                placeholder={t("tasks.newTaskPlaceholder")}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <DueDateField value={dueDate} status={status.id} onChange={setDueDate} />
            </div>
          )}
          {tasks.map((task) => <TaskRow key={task.id} task={task} />)}
          {tasks.length === 0 && !adding && (
            <div className="px-3 py-3 text-xs text-muted-foreground">{t("tasks.emptyGroup")}</div>
          )}
        </>
      )}
    </div>
  );
}

export function TaskList() {
  const tasks = useTasksStore((s) => s.tasks);

  const byStatus = useMemo(() => {
    const map = new Map<TaskStatusId, Task[]>();
    for (const s of TASK_STATUSES) map.set(s.id, []);
    for (const task of tasks) (map.get(task.status as TaskStatusId) ?? map.get("backlog")!).push(task);
    return map;
  }, [tasks]);

  return (
    <div className="flex-1 overflow-y-auto">
      {TASK_STATUSES.map((status) => (
        <StatusGroup key={status.id} status={status} tasks={byStatus.get(status.id) ?? []} />
      ))}
    </div>
  );
}
