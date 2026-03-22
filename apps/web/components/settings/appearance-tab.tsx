"use client";

import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { Sun, Moon, Monitor } from "lucide-react";
import { toast } from "sonner";

const themes = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
] as const;

const languages = [
  { id: "en", label: "English" },
  { id: "ko", label: "\uD55C\uAD6D\uC5B4" },
] as const;

export function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const [lang, setLang] = useState("en");

  useEffect(() => {
    setLang(localStorage.getItem("sayknowmind-lang") ?? "en");
  }, []);

  const handleLangChange = (id: string) => {
    localStorage.setItem("sayknowmind-lang", id);
    setLang(id);
    toast.success("Language updated. Reloading...");
    setTimeout(() => window.location.reload(), 500);
  };

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Theme</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Choose how SayKnowMind looks
          </p>
        </div>
        <div className="flex gap-3">
          {themes.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={cn(
                "flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors",
                theme === t.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/50"
              )}
            >
              <t.icon className="size-5" />
              <span className="text-sm font-medium capitalize">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Language</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Select your preferred language
          </p>
        </div>
        <div className="flex gap-3">
          {languages.map((l) => (
            <button
              key={l.id}
              onClick={() => handleLangChange(l.id)}
              className={cn(
                "flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors",
                lang === l.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-muted-foreground/50"
              )}
            >
              <span className="text-sm font-medium">{l.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
