"use client";

import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "@/lib/i18n";
import { initials } from "./shared";

interface OnlineUser {
  id: string;
  name: string | null;
  email: string | null;
  image: string | null;
}

/**
 * Shows team members currently online, refreshed by a heartbeat. Each POST to
 * /api/presence both marks the caller online and returns the other online
 * members, so one request does double duty. Heartbeat every 30s (inside the 45s
 * online window) plus an immediate beat on mount.
 */
export function PresenceBar() {
  const { t } = useTranslation();
  const [online, setOnline] = useState<OnlineUser[]>([]);

  useEffect(() => {
    let stopped = false;
    const beat = async () => {
      try {
        const res = await fetch("/api/presence", { method: "POST" });
        if (!res.ok) return;
        const data = await res.json();
        if (!stopped) setOnline(Array.isArray(data.online) ? data.online : []);
      } catch {
        /* offline — leave the last known list */
      }
    };
    void beat();
    const interval = setInterval(beat, 30_000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, []);

  if (online.length === 0) return null;

  const shown = online.slice(0, 5);
  const extra = online.length - shown.length;

  return (
    <div className="flex items-center gap-2">
      <span className="hidden md:inline text-[11px] text-muted-foreground">{t("tasks.online")}</span>
      <div className="flex -space-x-1.5">
        {shown.map((u) => (
          <Tooltip key={u.id}>
            <TooltipTrigger asChild>
              <span className="relative inline-block">
                <Avatar className="size-6 ring-2 ring-background">
                  {u.image && <AvatarImage src={u.image} alt="" />}
                  <AvatarFallback className="text-[9px]">{initials(u.name, u.email)}</AvatarFallback>
                </Avatar>
                <span className="absolute -bottom-0 -right-0 size-2 rounded-full bg-emerald-500 ring-1 ring-background" />
              </span>
            </TooltipTrigger>
            <TooltipContent>{u.name || u.email}</TooltipContent>
          </Tooltip>
        ))}
        {extra > 0 && (
          <span className="inline-flex items-center justify-center size-6 rounded-full bg-muted text-[10px] font-medium ring-2 ring-background">
            +{extra}
          </span>
        )}
      </div>
    </div>
  );
}
