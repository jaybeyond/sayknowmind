import { MemorySidebar } from "@/components/dashboard/sidebar";
import { MemoryHeader } from "@/components/dashboard/header";
import { FavoritesContent } from "@/components/dashboard/favorites-content";
import { SidebarProvider } from "@/components/ui/sidebar";

export const dynamic = "force-dynamic";

export default function FavoritesPage() {
  return (
    <SidebarProvider className="bg-sidebar">
      <MemorySidebar />
      <div className="h-svh overflow-hidden lg:p-2 w-full">
        <div className="lg:border lg:rounded-md overflow-hidden flex flex-col items-center justify-start bg-container h-full w-full bg-background">
          <MemoryHeader title="Favorites" />
          <FavoritesContent />
        </div>
      </div>
    </SidebarProvider>
  );
}
