"use client";

import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";
import { AgentSteps, type AgentStep } from "./agent-steps";

export type Citation = {
  id: string;
  title: string;
  url: string;
  excerpt?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  isStreaming?: boolean;
  citations?: Citation[];
  agentSteps?: AgentStep[];
};

interface ChatMessageProps {
  message: ChatMessage;
}

export function ChatMessageBubble({ message }: ChatMessageProps) {
  const isUser = message.role === "user";

  return (
    <div
      className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}
    >
      <div
        className={cn(
          "max-w-[80%] md:max-w-[70%] rounded-2xl px-4 py-3",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-card border border-border"
        )}
      >
        <div className="text-sm whitespace-pre-wrap break-words">
          {message.content}
          {message.isStreaming && (
            <span className="inline-block w-[2px] h-4 ml-0.5 align-text-bottom bg-current animate-pulse" />
          )}
        </div>

        {!isUser &&
          message.citations &&
          message.citations.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {message.citations.slice(0, 3).map((citation) => (
                <a
                  key={citation.id}
                  href={citation.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/60 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title={citation.excerpt}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`https://www.google.com/s2/favicons?domain=${new URL(citation.url).hostname}&sz=16`}
                    alt=""
                    className="size-3.5 rounded-sm"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                  <span className="truncate max-w-[140px]">
                    {citation.title}
                  </span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              ))}
            </div>
          )}

        {!isUser &&
          message.agentSteps &&
          message.agentSteps.length > 0 && (
            <AgentSteps
              steps={message.agentSteps}
              defaultOpen={message.isStreaming}
            />
          )}
      </div>
    </div>
  );
}
