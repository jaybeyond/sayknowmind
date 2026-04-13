"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "@/lib/i18n";

interface ServiceStatus {
  id: string;
  name: string;
  url: string;
  status: "online" | "offline" | "degraded";
  latencyMs?: number;
  version?: string;
}

export function ServicesTab() {
  const { t } = useTranslation();
  const [services, setServices] = useState<ServiceStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/services/status");
      if (res.ok) {
        const data = await res.json();
        if (data?.services) setServices(data.services);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const statusColor = (s: string) =>
    s === "online" ? "bg-green-500" : s === "degraded" ? "bg-yellow-500" : "bg-red-500";

  const statusLabel = (s: string) =>
    s === "online" ? t("integrations.online") : s === "degraded" ? t("integrations.degraded") : t("integrations.offline");

  if (loading) {
    return <div className="py-8 text-center text-muted-foreground text-sm">{t("integrations.loading")}</div>;
  }

  const onlineCount = services.filter((s) => s.status === "online").length;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1">{t("integrations.servicesTitle")}</h3>
        <p className="text-xs text-muted-foreground mb-3">
          {t("integrations.servicesDesc")} — {onlineCount}/{services.length} {t("integrations.online").toLowerCase()}
        </p>
      </div>

      <div className="grid gap-2">
        {services.map((svc) => (
          <div key={svc.id} className="flex items-center justify-between rounded-md border px-3 py-2.5">
            <div className="flex items-center gap-2.5">
              <span className={`inline-block h-2.5 w-2.5 rounded-full ${statusColor(svc.status)}`} />
              <div>
                <span className="text-sm font-medium">{svc.name}</span>
                {svc.version && <span className="text-xs text-muted-foreground ml-1.5">v{svc.version}</span>}
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              {svc.latencyMs != null && <span>{svc.latencyMs}ms</span>}
              <span className={svc.status === "online" ? "text-green-600" : svc.status === "degraded" ? "text-yellow-600" : "text-red-500"}>
                {statusLabel(svc.status)}
              </span>
            </div>
          </div>
        ))}
        {services.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("integrations.noServices")}</p>
        )}
      </div>

      <button
        onClick={fetchStatus}
        className="text-xs text-primary hover:underline"
      >
        {t("integrations.refresh")}
      </button>
    </div>
  );
}
