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

    // Remember across remounts/navigations — don't retry once we know it's down
    if (sessionStorage.getItem("tg-poll-dead")) return;

    let stopped = false;
    let consecutiveErrors = 0;
    let dead = false;

    const poll = async () => {
      if (dead) return;
      try {
        const res = await fetch("/api/integrations/telegram/poll", {
          method: "POST",
          signal: AbortSignal.timeout(15_000),
        });
        if (res.status === 401 || res.status === 400 || res.status === 502) {
          // Not logged in, no bot token, or service down — stop completely
          dead = true;
          sessionStorage.setItem("tg-poll-dead", "1");
          if (timerRef.current) clearInterval(timerRef.current);
          return;
        }
        if (res.ok) consecutiveErrors = 0;
        else consecutiveErrors++;
      } catch {
        consecutiveErrors++;
      }

      // Stop completely after 3 consecutive failures
      if (consecutiveErrors >= 3 && timerRef.current) {
        dead = true;
        sessionStorage.setItem("tg-poll-dead", "1");
        clearInterval(timerRef.current);
      }
    };

    poll();
    timerRef.current = setInterval(poll, 5_000);

    return () => {
      stopped = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return null;
}
