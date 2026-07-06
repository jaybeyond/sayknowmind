"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { toDatetimeLocal, fromDatetimeLocal, formatDue, isOverdue } from "./shared";

/**
 * A due date+time control: shows the current due date as a chip, and on click
 * reveals a native <input type="datetime-local"> to set/change it. Emits an ISO
 * instant (or null when cleared) via onChange. Used on task cards, list rows,
 * and the quick-add form.
 */
export function DueDateField({
  value,
  status = "backlog",
  onChange,
  size = "sm",
}: {
  value: string | null;
  status?: string;
  onChange: (iso: string | null) => void;
  size?: "sm" | "xs";
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const overdue = isOverdue(value, status);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="datetime-local"
          defaultValue={toDatetimeLocal(value)}
          onChange={(e) => onChange(fromDatetimeLocal(e.target.value))}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") setEditing(false); }}
          className="text-[11px] bg-background border border-border rounded px-1 py-0.5 outline-none focus:ring-1 focus:ring-primary"
        />
        {value && (
          <button
            onClick={() => { onChange(null); setEditing(false); }}
            className="p-0.5 rounded hover:bg-muted text-muted-foreground"
            title={t("tasks.clearDue")}
          >
            <X className="size-3" />
          </button>
        )}
      </span>
    );
  }

  return (
    <button
      onClick={(e) => { e.stopPropagation(); setEditing(true); }}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-muted transition-colors",
        size === "xs" ? "text-[10px]" : "text-[11px]",
        value ? (overdue ? "text-destructive" : "text-muted-foreground") : "text-muted-foreground/60",
      )}
      title={t("tasks.setDue")}
    >
      <CalendarDays className={size === "xs" ? "size-3" : "size-3.5"} />
      {value ? formatDue(value) : t("tasks.setDue")}
    </button>
  );
}
