"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ProfileTab } from "./profile-tab";
import { AppearanceTab } from "./appearance-tab";
import { AITab } from "./ai-tab";
import { ModelsTab } from "./models-tab";
import { PrivacyTab } from "./privacy-tab";
import { PromptEditor } from "./prompt-editor";
import { IntegrationsTab } from "./integrations-tab";
import { ServicesTab } from "./services-tab";
import { useTranslation } from "@/lib/i18n";

type TabId = "profile" | "appearance" | "ai" | "models" | "prompts" | "privacy" | "integrations" | "services";

export function SettingsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>("profile");

  const tabs = [
    { id: "profile" as TabId, label: t("settings.tabProfile") },
    { id: "appearance" as TabId, label: t("settings.tabAppearance") },
    { id: "ai" as TabId, label: t("settings.tabAi") },
    { id: "models" as TabId, label: t("settings.tabModels") },
    { id: "prompts" as TabId, label: t("settings.tabPrompts") },
    { id: "privacy" as TabId, label: t("settings.tabPrivacy") },
    { id: "integrations" as TabId, label: t("settings.tabIntegrations") },
    { id: "services" as TabId, label: t("settings.tabServices") },
  ];

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

        {activeTab === "profile" && <ProfileTab />}
        {activeTab === "appearance" && <AppearanceTab />}
        {activeTab === "ai" && <AITab />}
        {activeTab === "models" && <ModelsTab />}
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
      </div>
    </main>
  );
}
