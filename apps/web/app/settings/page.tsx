import { SidebarProvider } from "@/components/ui/sidebar";
import { MemorySidebar } from "@/components/dashboard/sidebar";
import { MemoryHeader } from "@/components/dashboard/header";
import { SettingsPage } from "@/components/settings/settings-page";

export const dynamic = "force-dynamic";

export default function Settings() {
  return (
    <SidebarProvider className="bg-sidebar">
      <MemorySidebar />
      <div className="h-svh overflow-hidden lg:p-2 w-full">
        <div className="lg:border lg:rounded-md overflow-hidden flex flex-col bg-container h-full w-full bg-background">
          <MemoryHeader title="Settings" showFilters={false} />
          <SettingsPage />
        </div>
      </div>
    </SidebarProvider>
  );
}
