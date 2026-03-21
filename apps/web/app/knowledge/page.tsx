import { BookmarksSidebar } from "@/components/dashboard/sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { KnowledgeDashboard } from "@/components/knowledge/knowledge-dashboard";

export default function KnowledgePage() {
  return (
    <SidebarProvider className="bg-sidebar">
      <BookmarksSidebar />
      <div className="h-svh overflow-hidden lg:p-2 w-full">
        <div className="lg:border lg:rounded-md overflow-hidden flex flex-col bg-container h-full w-full bg-background">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h1 className="font-heading font-semibold text-lg">Knowledge Graph</h1>
          </div>
          <KnowledgeDashboard />
        </div>
      </div>
    </SidebarProvider>
  );
}
