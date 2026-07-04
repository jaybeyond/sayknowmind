"use client";

import { AuthGate } from "@/components/dashboard/auth-gate";
import { MemorySidebar } from "@/components/dashboard/sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { PublicGallery } from "@/components/gallery/public-gallery";
import { ChunkWarmup } from "@/components/perf/chunk-warmup";

/**
 * Persistent dashboard shell. Rendered by the (shell) layout, so the sidebar +
 * AuthGate mount ONCE and survive navigation between menu routes — only the page
 * content (`children`) swaps. This is what makes menu clicks feel instant instead
 * of re-mounting the whole sidebar (and re-fetching memories/categories/insights
 * + re-subscribing SSE) on every navigation.
 *
 * Guests only ever reach `/` here (middleware redirects the protected routes to
 * /login), where AuthGate shows the public gallery.
 */
export function ShellClient({ children }: { children: React.ReactNode }) {
  return (
    <AuthGate
      authenticated={
        <SidebarProvider className="bg-sidebar">
          <MemorySidebar />
          <div className="h-svh overflow-hidden lg:p-2 w-full">{children}</div>
          <ChunkWarmup />
        </SidebarProvider>
      }
      guest={<PublicGallery />}
    />
  );
}
