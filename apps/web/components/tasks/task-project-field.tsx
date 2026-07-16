"use client";

import { FolderKanban } from "lucide-react";
import { useTasksStore } from "@/store/tasks-store";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function TaskProjectField({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (projectId: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const taskMode = useTasksStore((state) => state.taskMode);
  const projects = useTasksStore((state) => state.projects);
  const selectedProjectId = useTasksStore((state) => state.selectedProjectId);
  if (taskMode !== "bi") return null;

  if (selectedProjectId) {
    const project = projects.find((item) => item.id === selectedProjectId);
    return (
      <div className={cn("flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground", className)}>
        <FolderKanban className="size-3.5 shrink-0" />
        <span className="truncate text-foreground">{project?.name ?? selectedProjectId}</span>
      </div>
    );
  }

  return (
    <label className={cn("flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground", className)}>
      <FolderKanban className="size-3.5 shrink-0" />
      <span className="sr-only">{t("tasks.project")}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        className="min-w-0 max-w-full bg-background border border-border rounded-md px-2 py-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
      >
        <option value="" disabled>{t("tasks.selectProject")}</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>{project.name}</option>
        ))}
      </select>
    </label>
  );
}
