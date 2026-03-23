"use client";

import { MemorySidebar } from "@/components/dashboard/sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { KnowledgeDashboard } from "@/components/knowledge/knowledge-dashboard";
import { useTranslation } from "@/lib/i18n";

export default function KnowledgePage() {
  const { t } = useTranslation();

  return (
    <SidebarProvider className="bg-sidebar">
      <MemorySidebar />
      <div className="h-svh overflow-hidden lg:p-2 w-full">
        <div className="lg:border lg:rounded-md overflow-hidden flex flex-col bg-container h-full w-full bg-background">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h1 className="font-heading font-semibold text-lg">{t("knowledge.title")}</h1>
          </div>
          <div className="flex-1 min-h-0">
            <KnowledgeDashboard />
          </div>
        </div>
      </div>
    </SidebarProvider>
  );
}
