"use client";

import { useEffect, useRef } from "react";

/**
 * Auto-polls Telegram updates on localhost.
 * Silently skips if not authenticated or not on localhost.
 */
export function TelegramPoller() {
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const isLocal =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    if (!isLocal) return;

    let stopped = false;
    let consecutiveErrors = 0;

    const poll = async () => {
      try {
        const res = await fetch("/api/integrations/telegram/poll", {
          method: "POST",
          signal: AbortSignal.timeout(15_000),
        });
        if (res.status === 401) {
          // Not logged in — skip silently
          consecutiveErrors = 0;
          return;
        }
        if (res.ok) consecutiveErrors = 0;
        else consecutiveErrors++;
      } catch {
        consecutiveErrors++;
      }

      // Back off after repeated failures
      if (consecutiveErrors > 10 && timerRef.current) {
        clearInterval(timerRef.current);
        if (!stopped) {
          timerRef.current = setInterval(poll, 30_000); // slow down to 30s
        }
      }
    };

    poll();
    timerRef.current = setInterval(poll, 3_000);

    return () => {
      stopped = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return null;
}
