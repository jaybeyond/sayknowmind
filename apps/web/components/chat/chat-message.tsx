"use client";

import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { ChevronDown } from "lucide-react";
import { ThinkingIndicator, type ThinkingPhase } from "./thinking-indicator";
import { SourceCardRow, type SourceCardData } from "./source-card";

/** Normalize LLM output: collapse excessive newlines, trim leading whitespace */
function normalizeContent(text: string): string {
  return text
    .replace(/^\n+/, "")           // strip leading newlines
    .replace(/\n{3,}/g, "\n\n")    // collapse 3+ newlines → paragraph break
    .replace(/[ \t]+\n/g, "\n");   // strip trailing whitespace on lines
}

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  phase?: ThinkingPhase | "done";
  sources?: SourceCardData[];
  /** Log lines grouped by phase */
  phaseLogs?: Record<string, string[]>;
  /** Phases that have been completed (for showing completed indicators) */
  completedPhases?: ThinkingPhase[];
};

interface ChatMessageProps {
  message: ChatMessage;
}

export function ChatMessageBubble({ message }: ChatMessageProps) {
  const { t } = useTranslation();

  if (message.role === "user") {
    return (
      <div className="flex w-full justify-end">
        <div className="max-w-[80%] md:max-w-[70%] rounded-2xl px-4 py-3 bg-primary text-primary-foreground">
          <div className="text-sm whitespace-pre-wrap break-words">
            {message.content}
          </div>
        </div>
      </div>
    );
  }

  // Assistant message — structured layout with thinking process
  const currentPhase = message.phase;
  const completedPhases = message.completedPhases ?? [];
  const phaseLogs = message.phaseLogs ?? {};

  // Determine which phase indicators to show
  const showThinking =
    completedPhases.includes("thinking") ||
    currentPhase === "thinking";
  const showSearching =
    completedPhases.includes("searching") ||
    currentPhase === "searching";
  const showAnswering =
    currentPhase === "answering" ||
    currentPhase === "done";

  // Collapse phases once answer content starts appearing
  const hasAnswer = !!message.content;
  const hasProcessPhases = showThinking || showSearching;

  const phaseIndicators = (
    <>
      {showThinking && (
        <ThinkingIndicator
          phase="thinking"
          message={t("chat.phaseThinking")}
          logs={phaseLogs["thinking"]}
          isActive={currentPhase === "thinking"}
        />
      )}
      {showSearching && (
        <ThinkingIndicator
          phase="searching"
          message={t("chat.phaseSearching")}
          logs={phaseLogs["searching"]}
          isActive={currentPhase === "searching"}
        />
      )}
      {/* Answering phase — show LLM thinking logs before answer text appears */}
      {showAnswering && !hasAnswer && message.isStreaming && (
        <ThinkingIndicator
          phase="answering"
          message={t("chat.phaseAnswering")}
          logs={phaseLogs["answering"]}
          isActive
        />
      )}
      {/* Show answering logs while streaming answer too */}
      {showAnswering && hasAnswer && phaseLogs["answering"]?.length > 0 && (
        <ThinkingIndicator
          phase="answering"
          message={t("chat.phaseAnswering")}
          logs={phaseLogs["answering"]}
          isActive={message.isStreaming && currentPhase === "answering"}
        />
      )}
    </>
  );

  return (
    <div className="flex w-full justify-start">
      <div className={cn(
        "max-w-[90%] md:max-w-[80%] rounded-2xl px-4 py-3",
        "bg-card border border-border",
        "min-w-[300px]",
      )}>
        {/* When answer exists, collapse thinking/searching into expandable section */}
        {hasAnswer && hasProcessPhases ? (
          <details className="mb-2 group">
            <summary className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors select-none list-none [&::-webkit-details-marker]:hidden">
              <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" />
              <span>{t("chat.phaseThinking").replace("...", "")}</span>
              <span className="text-muted-foreground/60">·</span>
              <span>{t("chat.phaseSearching").replace("...", "")}</span>
            </summary>
            <div className="mt-2">
              {phaseIndicators}
            </div>
          </details>
        ) : (
          phaseIndicators
        )}

        {/* Sources */}
        {message.sources && message.sources.length > 0 && (
          <SourceCardRow sources={message.sources} />
        )}

        {/* Answer text */}
        {hasAnswer && (
          <div className="text-sm whitespace-pre-wrap break-words mt-1">
            {normalizeContent(message.content)}
            {message.isStreaming && currentPhase === "answering" && (
              <span className="inline-block w-[2px] h-4 ml-0.5 align-text-bottom bg-current animate-pulse" />
            )}
          </div>
        )}

        {/* Empty final state */}
        {!message.content && !message.isStreaming && currentPhase === "done" && (
          <div className="text-sm text-muted-foreground italic">
            {t("chat.noResponse")}
          </div>
        )}
      </div>
    </div>
  );
}
