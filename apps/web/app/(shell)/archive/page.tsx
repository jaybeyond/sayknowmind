import { MemoryHeader } from "@/components/dashboard/header";
import { ArchiveContent } from "@/components/dashboard/archive-content";

export default function ArchivePage() {
  return (
    <div className="lg:border lg:rounded-md overflow-hidden flex flex-col items-center justify-start bg-container h-full w-full bg-background">
      <MemoryHeader titleKey="sidebar.archive" />
      <ArchiveContent />
    </div>
  );
}
