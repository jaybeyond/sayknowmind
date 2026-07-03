import { MemoryHeader } from "@/components/dashboard/header";
import { KnowledgeContent } from "./content";

export default function KnowledgePage() {
  return (
    <div className="lg:border lg:rounded-md overflow-hidden flex flex-col bg-container h-full w-full bg-background">
      <MemoryHeader titleKey="sidebar.knowledge" showFilters={false} />
      <KnowledgeContent />
    </div>
  );
}
