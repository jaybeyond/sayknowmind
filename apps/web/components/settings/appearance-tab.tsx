"use client";

import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { Sun, Moon, Monitor } from "lucide-react";
import { useTranslation, localeNames, type Locale } from "@/lib/i18n";
import { toast } from "sonner";

const themeIcons = { light: Sun, dark: Moon, system: Monitor } as const;

export function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const { t, locale, setLocale } = useTranslation();

  const themes = [
    { id: "light" as const, label: t("settings.themeLight"), icon: themeIcons.light },
    { id: "dark" as const, label: t("settings.themeDark"), icon: themeIcons.dark },
    { id: "system" as const, label: t("settings.themeSystem"), icon: themeIcons.system },
  ];

  const handleLangChange = (id: Locale) => {
    setLocale(id);
    toast.success(t("settings.languageUpdated"));
  };

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">{t("settings.theme")}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("settings.themeDesc")}
          </p>
        </div>
        <div className="flex gap-3">
          {themes.map((themeOption) => (
            <button
              key={themeOption.id}
              onClick={() => setTheme(themeOption.id)}
              className={cn(
                "flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors",
                theme === themeOption.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/50"
              )}
            >
              <themeOption.icon className="size-5" />
              <span className="text-sm font-medium capitalize">{themeOption.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">{t("settings.language")}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("settings.languageDesc")}
          </p>
        </div>
        <div className="flex gap-3 flex-wrap">
          {(Object.entries(localeNames) as [Locale, string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => handleLangChange(id)}
              className={cn(
                "flex-1 min-w-[80px] flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors",
                locale === id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/50"
              )}
            >
              <span className="text-sm font-medium">{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
