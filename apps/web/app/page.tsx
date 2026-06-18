import { MemorySidebar } from "@/components/dashboard/sidebar";
import { MemoryHeader } from "@/components/dashboard/header";
import { MemoryContent } from "@/components/dashboard/content";
import { SidebarProvider } from "@/components/ui/sidebar";
import { PublicGallery } from "@/components/gallery/public-gallery";
import { AuthGate } from "@/components/dashboard/auth-gate";

// The dashboard shell is per-user (AuthGate picks the authenticated vs guest
// tree at runtime), so it must NOT be statically prerendered. Without this,
// Next.js emits `Cache-Control: s-maxage=31536000` and the CDN/edge serves a
// year-old HTML that still points at stale JS chunks — which is why freshly
// deployed UI (e.g. new sidebar menus) never showed up on prod.
export const dynamic = "force-dynamic";

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
