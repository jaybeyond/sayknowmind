"use client";

import { Brain, Search, Sparkles } from "lucide-react";

const phaseConfig = {
  thinking: {
    icon: Brain,
    color: "text-purple-500",
    bg: "bg-purple-500/10",
    border: "border-purple-500/20",
  },
  searching: {
    icon: Search,
    color: "text-blue-500",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
  },
  answering: {
    icon: Sparkles,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
} as const;

export type ThinkingPhase = keyof typeof phaseConfig;

export function ThinkingIndicator({
  phase,
  message,
  logs,
  isActive,
}: {
  phase: ThinkingPhase;
  message?: string;
  logs?: string[];
  isActive?: boolean;
}) {
  const config = phaseConfig[phase];
  const Icon = config.icon;

  return (
    <div className={`rounded-lg border ${config.border} ${config.bg} p-3 mb-2`}>
      {/* Phase header */}
      <div className="flex items-center gap-2">
        <div className={`${config.color} ${isActive ? "animate-pulse" : ""}`}>
          <Icon className="size-4" />
        </div>
        <span className={`text-sm font-medium ${config.color}`}>
          {message || phase}
        </span>
        {isActive && (
          <span className="flex gap-0.5 ml-1">
            <span className="size-1 rounded-full bg-current opacity-40 animate-bounce [animation-delay:0ms]" />
            <span className="size-1 rounded-full bg-current opacity-40 animate-bounce [animation-delay:150ms]" />
            <span className="size-1 rounded-full bg-current opacity-40 animate-bounce [animation-delay:300ms]" />
          </span>
        )}
      </div>

      {/* Log lines */}
      {logs && logs.length > 0 && (
        <div className="mt-2 space-y-0.5 pl-6">
          {logs.map((log, i) => (
            <p
              key={i}
              className="text-xs text-muted-foreground font-mono leading-relaxed"
            >
              {log}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
