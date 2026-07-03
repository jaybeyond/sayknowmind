import { MemoryHeader } from "@/components/dashboard/header";
import { TrashContent } from "@/components/dashboard/trash-content";

export default function TrashPage() {
  return (
    <div className="lg:border lg:rounded-md overflow-hidden flex flex-col items-center justify-start bg-container h-full w-full bg-background">
      <MemoryHeader titleKey="sidebar.trash" />
      <TrashContent />
    </div>
  );
}
