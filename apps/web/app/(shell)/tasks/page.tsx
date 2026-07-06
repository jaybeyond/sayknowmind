import { MemoryHeader } from "@/components/dashboard/header";
import { TasksWorkspace } from "@/components/tasks/tasks-workspace";

export default function TasksPage() {
  return (
    <div className="lg:border lg:rounded-md overflow-hidden flex flex-col bg-container h-full w-full bg-background">
      <MemoryHeader titleKey="sidebar.tasks" showFilters={false} />
      <TasksWorkspace />
    </div>
  );
}
