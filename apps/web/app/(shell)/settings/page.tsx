import { MemoryHeader } from "@/components/dashboard/header";
import { SettingsPage } from "@/components/settings/settings-page";

export default function Settings() {
  return (
    <div className="lg:border lg:rounded-md overflow-hidden flex flex-col bg-container h-full w-full bg-background">
      <MemoryHeader titleKey="sidebar.settings" showFilters={false} />
      <SettingsPage />
    </div>
  );
}
