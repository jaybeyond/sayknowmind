import { MemorySidebar } from "@/components/dashboard/sidebar";
import { MemoryHeader } from "@/components/dashboard/header";
import { MemoryContent } from "@/components/dashboard/content";
import { SidebarProvider } from "@/components/ui/sidebar";
import { PublicGallery } from "@/components/gallery/public-gallery";
import { AuthGate } from "@/components/dashboard/auth-gate";

export default function RootPage() {
  return (
    <AuthGate
      authenticated={
        <SidebarProvider className="bg-sidebar">
          <MemorySidebar />
          <div className="h-svh overflow-hidden lg:p-2 w-full">
            <div className="lg:border lg:rounded-md overflow-hidden flex flex-col items-center justify-start bg-container h-full w-full bg-background">
              <MemoryHeader />
              <MemoryContent />
            </div>
          </div>
        </SidebarProvider>
      }
      guest={<PublicGallery />}
    />
  );
}
