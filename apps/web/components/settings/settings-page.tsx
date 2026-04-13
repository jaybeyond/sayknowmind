"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ProfileTab } from "./profile-tab";
import { AppearanceTab } from "./appearance-tab";
import { AITab } from "./ai-tab";
import { ModelsTab } from "./models-tab";
import { PrivacyTab } from "./privacy-tab";
import { PromptEditor } from "./prompt-editor";
import { IntegrationsTab } from "./integrations-tab";
import { ServicesTab } from "./services-tab";
import { LocalRuntimeTab } from "./local-runtime-tab";
import { McpConnectTab } from "./mcp-connect-tab";
import { useTranslation } from "@/lib/i18n";
import { isCloud, isDesktop } from "@/lib/environment";

type TabId = "profile" | "appearance" | "ai" | "models" | "prompts" | "privacy" | "integrations" | "services" | "mcp" | "runtime";

export function SettingsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>("profile");

  const cloud = isCloud();
  const desktop = isDesktop();

  const tabs = useMemo(() => {
    const all: { id: TabId; label: string }[] = [
      { id: "profile", label: t("settings.tabProfile") },
      { id: "appearance", label: t("settings.tabAppearance") },
      { id: "ai", label: t("settings.tabAi") },
      // Models tab only shown in desktop mode or when not explicitly cloud
      ...(!cloud ? [{ id: "models" as TabId, label: t("settings.tabModels") }] : []),
      { id: "prompts", label: t("settings.tabPrompts") },
      { id: "privacy", label: t("settings.tabPrivacy") },
      { id: "integrations", label: t("settings.tabIntegrations") },
      { id: "services", label: t("settings.tabServices") },
      { id: "mcp", label: "MCP" },
      ...(desktop ? [{ id: "runtime" as TabId, label: t("settings.tabRuntime") }] : []),
    ];
    return all;
  }, [t, cloud, desktop]);

  return (
    <main className="flex-1 overflow-auto">
      <div className="max-w-2xl mx-auto p-6 md:p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">{t("settings.title")}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t("settings.description")}
          </p>
        </div>

        <div className="flex gap-1 border-b">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors",
                activeTab === tab.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Environment mode banner */}
        {(cloud || desktop) && (
          <div className={cn(
            "rounded-lg px-3 py-2 text-xs font-medium",
            cloud ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          )}>
            {cloud ? t("settings.cloudModeNote") : t("settings.desktopModeNote")}
          </div>
        )}

        {activeTab === "profile" && <ProfileTab />}
        {activeTab === "appearance" && <AppearanceTab />}
        {activeTab === "ai" && <AITab />}
        {activeTab === "models" && !cloud && <ModelsTab />}
        {activeTab === "prompts" && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium">{t("settings.summaryPrompts")}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("settings.summaryPromptsDesc")}
              </p>
            </div>
            <PromptEditor />
          </div>
        )}
        {activeTab === "privacy" && <PrivacyTab />}
        {activeTab === "integrations" && <IntegrationsTab />}
        {activeTab === "services" && <ServicesTab />}
        {activeTab === "mcp" && <McpConnectTab />}
        {activeTab === "runtime" && <LocalRuntimeTab />}
      </div>
    </main>
  );
}
