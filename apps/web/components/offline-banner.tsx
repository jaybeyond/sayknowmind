"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

/**
 * Offline banner — shows when network connectivity is lost.
 * Works for both desktop (Tauri) and mobile (Capacitor) since both use
 * the web view's navigator.onLine API.
 *
 * Requirements: 12.2, 12.6
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const { t } = useTranslation();

  useEffect(() => {
    // Sync with browser state via event handlers
    const sync = () => setOffline(!navigator.onLine);
    sync();

    const handleOffline = () => setOffline(true);
    const handleOnline = () => setOffline(false);

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div className="fixed top-0 inset-x-0 z-50 flex items-center justify-center gap-2 bg-yellow-500/90 px-4 py-2 text-sm font-medium text-black backdrop-blur-sm">
      <WifiOff className="h-4 w-4 shrink-0" />
      <span>{t("offline.banner")}</span>
    </div>
  );
}
