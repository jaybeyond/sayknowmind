"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ProfileTab } from "./profile-tab";
import { AppearanceTab } from "./appearance-tab";
import { AITab } from "./ai-tab";
import { PrivacyTab } from "./privacy-tab";
import { PromptEditor } from "./prompt-editor";

const tabs = [
  { id: "profile", label: "Profile" },
  { id: "appearance", label: "Appearance" },
  { id: "ai", label: "AI" },
  { id: "prompts", label: "Prompts" },
  { id: "privacy", label: "Privacy" },
] as const;

type TabId = (typeof tabs)[number]["id"];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("profile");

  return (
    <main className="flex-1 overflow-auto">
      <div className="max-w-2xl mx-auto p-6 md:p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Manage your account and preferences
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
        {activeTab === "prompts" && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium">Summary Prompts</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Customize how AI summarizes your saved content
              </p>
            </div>
            <PromptEditor />
          </div>
        )}
        {activeTab === "privacy" && <PrivacyTab />}
      </div>
    </main>
  );
}
