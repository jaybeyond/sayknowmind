"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Bell, Check, CheckCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
}

export function NotificationBell() {
  const { t } = useTranslation();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Fetch notifications
  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications?limit=20");
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch { /* ignore */ }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // SSE stream for real-time updates
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      eventSource = new EventSource("/api/notifications/stream");

      eventSource.addEventListener("notification", (event) => {
        try {
          const notif = JSON.parse(event.data) as Notification;
          setNotifications((prev) => [notif, ...prev].slice(0, 50));
          setUnreadCount((prev) => prev + 1);
        } catch { /* ignore */ }
      });

      eventSource.onerror = () => {
        eventSource?.close();
        // Reconnect after 5s
        retryTimeout = setTimeout(connect, 5000);
      };
    }

    connect();
    return () => {
      eventSource?.close();
      clearTimeout(retryTimeout);
    };
  }, []);

  // Close panel on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  const markAllRead = async () => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch { /* ignore */ }
  };

  const markOneRead = async (id: string) => {
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch { /* ignore */ }
  };

  const deleteOne = async (id: string) => {
    try {
      await fetch("/api/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
      const removed = notifications.find((n) => n.id === id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      if (removed && !removed.read) setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch { /* ignore */ }
  };

  const deleteAll = async () => {
    try {
      await fetch("/api/notifications", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setNotifications([]);
      setUnreadCount(0);
    } catch { /* ignore */ }
  };

  const typeIcon = (type: string) => {
    switch (type) {
      case "job_complete": return "\u{1F4DD}";
      case "related_found": return "\u{1F517}";
      case "category_assigned": return "\u{1F4C2}";
      case "job_failed": return "\u{26A0}\u{FE0F}";
      default: return "\u{1F514}";
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      <Button
        variant="ghost"
        size="icon"
        className="relative"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 size-4 rounded-full bg-primary text-[10px] font-bold text-primary-foreground flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </Button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-2 w-80 max-h-96 flex flex-col rounded-xl border border-border bg-popover shadow-lg z-50">
          {/* Sticky Header */}
          <div className="sticky top-0 flex items-center justify-between px-4 py-3 border-b border-border bg-popover rounded-t-xl z-10">
            <h3 className="text-sm font-semibold">{t("notifications.title")}</h3>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <CheckCheck className="size-3" />
                  {t("notifications.markAllRead")}
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  onClick={deleteAll}
                  className="text-xs text-destructive hover:underline flex items-center gap-1"
                >
                  <Trash2 className="size-3" />
                  {t("notifications.deleteAll")}
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className="overflow-auto flex-1">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                {t("notifications.empty")}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {notifications.map((notif) => (
                  <div
                    key={notif.id}
                    className={cn(
                      "group/notif flex items-start gap-3 px-4 py-3 hover:bg-muted/50 transition-colors",
                      !notif.read && "bg-primary/5"
                    )}
                  >
                    <span className="text-base mt-0.5 shrink-0">{typeIcon(notif.type)}</span>
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm leading-snug", !notif.read && "font-medium")}>
                        {notif.title}
                      </p>
                      {notif.body && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {notif.body}
                        </p>
                      )}
                      <span className="text-[10px] text-muted-foreground/60 mt-1 block">
                        {new Date(notif.createdAt).toLocaleString(undefined, {
                          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <div className="shrink-0 flex items-center gap-0.5">
                      {!notif.read && (
                        <button
                          onClick={() => markOneRead(notif.id)}
                          className="p-1 rounded hover:bg-muted text-muted-foreground"
                          title={t("notifications.markRead")}
                        >
                          <Check className="size-3" />
                        </button>
                      )}
                      <button
                        onClick={() => deleteOne(notif.id)}
                        className="p-1 rounded hover:bg-destructive/10 text-muted-foreground opacity-0 group-hover/notif:opacity-100 transition-opacity"
                        title={t("notifications.delete")}
                      >
                        <Trash2 className="size-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
