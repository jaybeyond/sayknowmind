"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SendHorizontal, Sparkles, MessageSquare } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface ChatInputProps {
  onSend: (message: string) => void;
  isDisabled: boolean;
  mode: "simple" | "agentic";
  onModeChange: (mode: "simple" | "agentic") => void;
}

export function ChatInput({
  onSend,
  isDisabled,
  mode,
  onModeChange,
}: ChatInputProps) {
  const { t } = useTranslation();
  const [value, setValue] = React.useState("");
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const adjustHeight = React.useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    const maxHeight = 5 * 24; // ~5 rows
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  }, []);

  React.useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (!trimmed || isDisabled) return;
    onSend(trimmed);
    setValue("");
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="space-y-2">
      <div className="relative flex items-end gap-2 rounded-xl border border-border bg-card p-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("chat.placeholder")}
          disabled={isDisabled}
          rows={1}
          className={cn(
            "flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50",
            "min-h-[36px] max-h-[120px]"
          )}
        />
        <Button
          size="icon"
          onClick={handleSubmit}
          disabled={isDisabled || !value.trim()}
          className="shrink-0 size-8 rounded-lg"
        >
          <SendHorizontal className="size-4" />
        </Button>
      </div>

      <div className="flex items-center justify-between">
        <div className="inline-flex items-center rounded-lg bg-muted p-0.5 text-xs">
          <button
            onClick={() => onModeChange("simple")}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2.5 py-1 transition-colors",
              mode === "simple"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <MessageSquare className="size-3" />
            {t("chat.simpleMode")}
          </button>
          <button
            onClick={() => onModeChange("agentic")}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2.5 py-1 transition-colors",
              mode === "agentic"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Sparkles className="size-3" />
            {t("chat.agenticMode")}
          </button>
        </div>

        {value.length > 500 && (
          <span className="text-xs text-muted-foreground">
            {value.length.toLocaleString()}
          </span>
        )}
      </div>
    </div>
  );
}
