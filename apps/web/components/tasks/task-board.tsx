"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { TASK_STATUSES, type Task, type TaskStatusId } from "@/lib/tasks/constants";
import { useTasksStore } from "@/store/tasks-store";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskCard } from "./task-card";

function QuickAdd({ status, onDone }: { status: TaskStatusId; onDone: () => void }) {
  const { t } = useTranslation();
  const createTask = useTasksStore((s) => s.createTask);
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      onDone();
      return;
    }
    setTitle("");
    await createTask({ title: trimmed, status });
    onDone();
  };

  return (
    <div className="rounded-lg border border-primary/40 bg-background p-2">
      <textarea
        ref={inputRef}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          } else if (e.key === "Escape") {
            onDone();
          }
        }}
        onBlur={() => void submit()}
        placeholder={t("tasks.newTaskPlaceholder")}
        rows={2}
        className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

function BoardColumn({
  status,
  tasks,
  onDropTask,
  draggingId,
  setDraggingId,
}: {
  status: (typeof TASK_STATUSES)[number];
  tasks: Task[];
  onDropTask: (id: string, status: TaskStatusId) => void;
  draggingId: string | null;
  setDraggingId: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [over, setOver] = useState(false);

  return (
    <div className="flex w-72 shrink-0 flex-col">
      <div className="flex items-center gap-2 px-1 pb-2">
        <span className="size-2.5 rounded-full" style={{ backgroundColor: status.color }} />
        <h3 className="text-sm font-semibold">{t(status.labelKey)}</h3>
        <span className="text-xs text-muted-foreground tabular-nums">{tasks.length}</span>
        <button
          onClick={() => setAdding(true)}
          className="ml-auto p-0.5 rounded hover:bg-muted text-muted-foreground"
          title={t("tasks.addTask")}
        >
          <Plus className="size-4" />
        </button>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          if (!over) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const id = e.dataTransfer.getData("text/plain") || draggingId;
          if (id) onDropTask(id, status.id);
          setDraggingId(null);
        }}
        className={cn(
          "flex-1 min-h-24 space-y-2 rounded-lg p-1.5 transition-colors",
          over ? "bg-primary/5 ring-1 ring-primary/30" : "bg-muted/30",
        )}
      >
        {adding && <QuickAdd status={status.id} onDone={() => setAdding(false)} />}
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} onDragStart={setDraggingId} />
        ))}
        {tasks.length === 0 && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="w-full rounded-lg border border-dashed border-border py-6 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
          >
            {t("tasks.addTask")}
          </button>
        )}
      </div>
    </div>
  );
}

export function TaskBoard() {
  const { t } = useTranslation();
  const tasks = useTasksStore((s) => s.tasks);
  const isLoading = useTasksStore((s) => s.isLoading);
  const fetchTasks = useTasksStore((s) => s.fetchTasks);
  const fetchMembers = useTasksStore((s) => s.fetchMembers);
  const moveTask = useTasksStore((s) => s.moveTask);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    fetchTasks();
    fetchMembers();
  }, [fetchTasks, fetchMembers]);

  const byStatus = useMemo(() => {
    const map = new Map<TaskStatusId, Task[]>();
    for (const s of TASK_STATUSES) map.set(s.id, []);
    for (const task of tasks) {
      const bucket = map.get(task.status as TaskStatusId);
      if (bucket) bucket.push(task);
      else map.get("backlog")!.push(task);
    }
    return map;
  }, [tasks]);

  if (isLoading) {
    return (
      <div className="flex gap-4 p-4 overflow-x-auto">
        {TASK_STATUSES.map((s) => (
          <div key={s.id} className="w-72 shrink-0 space-y-2">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-x-auto overflow-y-hidden">
      <div className="flex h-full gap-4 p-4">
        {TASK_STATUSES.map((status) => (
          <BoardColumn
            key={status.id}
            status={status}
            tasks={byStatus.get(status.id) ?? []}
            onDropTask={(id, s) => moveTask(id, s)}
            draggingId={draggingId}
            setDraggingId={setDraggingId}
          />
        ))}
      </div>
      <span className="sr-only">{t("tasks.title")}</span>
    </div>
  );
}
