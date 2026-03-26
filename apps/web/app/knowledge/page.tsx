import { MemorySidebar } from "@/components/dashboard/sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { KnowledgeContent } from "./content";

export const dynamic = "force-dynamic";

export default function KnowledgePage() {
  return (
    <SidebarProvider className="bg-sidebar">
      <MemorySidebar />
      <div className="h-svh overflow-hidden lg:p-2 w-full">
        <div className="lg:border lg:rounded-md overflow-hidden flex flex-col bg-container h-full w-full bg-background">
          <KnowledgeContent />
        </div>
      </div>
    </SidebarProvider>
  );
}
