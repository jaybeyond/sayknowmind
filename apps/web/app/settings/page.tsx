"use client";

export const dynamic = "force-dynamic";

import { SidebarProvider } from "@/components/ui/sidebar";
import { MemorySidebar } from "@/components/dashboard/sidebar";
import { SettingsPage } from "@/components/settings/settings-page";

export default function Settings() {
  return (
    <SidebarProvider>
      <MemorySidebar />
      <SettingsPage />
    </SidebarProvider>
  );
}
