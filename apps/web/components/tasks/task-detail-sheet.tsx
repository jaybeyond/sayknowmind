"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Trash2 } from "lucide-react";
import { TASK_STATUSES, TASK_PRIORITIES } from "@/lib/tasks/constants";
import { useTasksStore } from "@/store/tasks-store";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PRIORITY_DOT, initials } from "./shared";
import { DueDateField } from "./due-date-field";

/**
 * Detail editor for a single task, opened from any view (board/list/calendar/
 * timeline) via the store's selectedTaskId. Every field writes through
 * updateTask, so edits reflect in all views at once. Title/description are
 * committed on blur; the rest apply immediately on change.
 */
export function TaskDetailSheet() {
  const { t } = useTranslation();
  const selectedTaskId = useTasksStore((s) => s.selectedTaskId);
  const task = useTasksStore((s) => s.tasks.find((x) => x.id === s.selectedTaskId) ?? null);
  const members = useTasksStore((s) => s.members);
  const updateTask = useTasksStore((s) => s.updateTask);
  const deleteTask = useTasksStore((s) => s.deleteTask);
  const closeTask = useTasksStore((s) => s.closeTask);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // Re-seed the local editable fields when a different task is opened. Standard
  // "sync form state to the selected entity" pattern (same as the memory detail
  // panel); the setState here is intentional, not a cascading-render smell.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- seed form on task identity change */
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description ?? "");
    }
  }, [task?.id]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  const status = useMemo(() => TASK_STATUSES.find((s) => s.id === task?.status), [task?.status]);

  const open = Boolean(selectedTaskId && task);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) closeTask(); }}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        {task && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="tabular-nums">{task.identifier}</span>
                {status && (
                  <span className="inline-flex items-center gap-1">
                    <span className="size-2 rounded-full" style={{ backgroundColor: status.color }} />
                    {t(status.labelKey)}
                  </span>
                )}
              </div>
              <SheetTitle className="sr-only">{task.title}</SheetTitle>
            </SheetHeader>

            <div className="px-4 pb-6 space-y-5">
              {/* Title */}
              <textarea
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => {
                  const trimmed = title.trim();
                  if (trimmed && trimmed !== task.title) updateTask(task.id, { title: trimmed });
                  else if (!trimmed) setTitle(task.title);
                }}
                rows={2}
                className="w-full resize-none bg-transparent text-lg font-semibold outline-none"
              />

              {/* Field grid */}
              <div className="space-y-3 text-sm">
                <Field label={t("tasks.setStatus")}>
                  <div className="flex flex-wrap gap-1.5">
                    {TASK_STATUSES.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => updateTask(task.id, { status: s.id })}
                        className={cn(
                          "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border transition-colors",
                          task.status === s.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
                        )}
                      >
                        <span className="size-2 rounded-full" style={{ backgroundColor: s.color }} />
                        {t(s.labelKey)}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label={t("tasks.setPriority")}>
                  <div className="flex flex-wrap gap-1.5">
                    {TASK_PRIORITIES.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => updateTask(task.id, { priority: p.id })}
                        className={cn(
                          "inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border transition-colors",
                          task.priority === p.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
                        )}
                      >
                        <span className={cn("size-2 rounded-full", PRIORITY_DOT[p.id])} />
                        {t(p.labelKey)}
                      </button>
                    ))}
                  </div>
                </Field>

                <Field label={t("tasks.assign")}>
                  <select
                    value={task.assignee?.id ?? ""}
                    onChange={(e) => {
                      const id = e.target.value || null;
                      const m = members.find((x) => x.id === id) ?? null;
                      updateTask(task.id, { assigneeId: id, assignee: m });
                    }}
                    className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">{t("tasks.unassigned")}</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>{m.name || m.email}</option>
                    ))}
                  </select>
                  {task.assignee && (
                    <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <Avatar className="size-5">
                        {task.assignee.image && <AvatarImage src={task.assignee.image} alt="" />}
                        <AvatarFallback className="text-[9px]">{initials(task.assignee.name, task.assignee.email)}</AvatarFallback>
                      </Avatar>
                      {task.assignee.name || task.assignee.email}
                    </div>
                  )}
                </Field>

                <div className="flex gap-6">
                  <Field label={t("tasks.startDate")}>
                    <DueDateField value={task.startDate} onChange={(iso) => updateTask(task.id, { startDate: iso })} />
                  </Field>
                  <Field label={t("tasks.setDue")}>
                    <DueDateField value={task.dueDate} status={task.status} onChange={(iso) => updateTask(task.id, { dueDate: iso })} />
                  </Field>
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  {t("tasks.description")}
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={() => {
                    if ((task.description ?? "") !== description) updateTask(task.id, { description });
                  }}
                  rows={5}
                  placeholder={t("tasks.descriptionPlaceholder")}
                  className="mt-1.5 w-full resize-y bg-muted/30 border border-border rounded-md p-2 text-sm outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
                />
              </div>

              <button
                onClick={() => deleteTask(task.id)}
                className="inline-flex items-center gap-1.5 text-sm text-destructive hover:underline"
              >
                <Trash2 className="size-4" />
                {t("tasks.delete")}
              </button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">{label}</div>
      {children}
    </div>
  );
}
