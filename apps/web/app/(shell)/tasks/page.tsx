import { MemoryHeader } from "@/components/dashboard/header";
import { TaskBoard } from "@/components/tasks/task-board";

export default function TasksPage() {
  return (
    <div className="lg:border lg:rounded-md overflow-hidden flex flex-col bg-container h-full w-full bg-background">
      <MemoryHeader titleKey="sidebar.tasks" showFilters={false} />
      <TaskBoard />
    </div>
  );
}
