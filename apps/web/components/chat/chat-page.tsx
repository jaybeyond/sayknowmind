"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus, MessageSquare, Trash2 } from "lucide-react";
import { ChatMessageBubble, type ChatMessage } from "./chat-message";
import { ChatInput } from "./chat-input";
import type { ThinkingPhase } from "./thinking-indicator";
import type { SourceCardData } from "./source-card";
import { useTranslation } from "@/lib/i18n";

type ConversationMeta = {
  id: string;
  title: string;
  updated_at: string;
};

function formatDate(dateStr: string, t: (key: string) => string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return t("chat.today");
  if (diffDays === 1) return t("chat.yesterday");
  if (diffDays < 7)
    return t("chat.daysAgo").replace("{{days}}", String(diffDays));
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ChatPage() {
  const { t } = useTranslation();
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [conversationId, setConversationId] = React.useState<string | null>(
    null,
  );
  const [conversations, setConversations] = React.useState<ConversationMeta[]>(
    [],
  );
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  // Auto-scroll to bottom
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Load conversation list on mount
  React.useEffect(() => {
    fetchConversations();
  }, []);

  const fetchConversations = async () => {
    try {
      const res = await fetch("/api/conversations");
      if (!res.ok) return;
      const data = await res.json();
      setConversations(data.conversations ?? []);
    } catch {
      // ignore
    }
  };

  const startNewConversation = () => {
    if (abortRef.current) abortRef.current.abort();
    setMessages([]);
    setConversationId(null);
    setIsStreaming(false);
  };

  const loadConversation = async (convId: string) => {
    if (abortRef.current) abortRef.current.abort();
    setIsStreaming(false);
    setConversationId(convId);

    try {
      const res = await fetch(`/api/conversations/${convId}/messages`);
      if (!res.ok) {
        setMessages([]);
        return;
      }
      const data = await res.json();
      const loaded: ChatMessage[] = (data.messages ?? []).map(
        (m: { id: string; role: string; content: string }) => ({
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
        }),
      );
      setMessages(loaded);
    } catch {
      setMessages([]);
    }
  };

  const deleteConversation = async (convId: string) => {
    try {
      await fetch(`/api/conversations/${convId}`, { method: "DELETE" });
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (conversationId === convId) {
        startNewConversation();
      }
    } catch {
      // ignore
    }
  };

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsStreaming(false);
    // Finalize the streaming message
    setMessages((prev) =>
      prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false, phase: "done" as const } : m)),
    );
  };

  const handleSend = async (message: string) => {
    if (!message.trim() || isStreaming) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
    };
    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      isStreaming: true,
      phase: "thinking",
      sources: [],
      phaseLogs: {},
      completedPhases: [],
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ message, conversationId }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Chat request failed: ${response.status}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));

            if (event.type === "status") {
              const phase = event.phase as ThinkingPhase;
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantMsg.id) return m;
                  const completed = [...(m.completedPhases ?? [])];
                  // Mark previous phase as completed on transition
                  if (m.phase && m.phase !== "done" && m.phase !== phase && !completed.includes(m.phase)) {
                    completed.push(m.phase);
                  }
                  return { ...m, phase, completedPhases: completed };
                }),
              );
            } else if (event.type === "log") {
              const logMsg = event.message as string;
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantMsg.id) return m;
                  const currentPhase = m.phase ?? "thinking";
                  const logs = { ...(m.phaseLogs ?? {}) };
                  logs[currentPhase] = [...(logs[currentPhase] ?? []), logMsg];
                  return { ...m, phaseLogs: logs };
                }),
              );
            } else if (event.type === "sources") {
              const sources = event.sources as SourceCardData[];
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id ? { ...m, sources } : m,
                ),
              );
            } else if (event.type === "answer") {
              const token = event.token ?? "";
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, content: m.content + token, phase: "answering" as const }
                    : m,
                ),
              );
            } else if (event.type === "done") {
              const newConvId = event.conversationId;
              if (newConvId && newConvId !== conversationId) {
                setConversationId(newConvId);
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, isStreaming: false, phase: "done" as const }
                    : m,
                ),
              );
              // Refresh conversation list
              fetchConversations();
            } else if (event.type === "error") {
              const errorMsg = event.message ?? "An error occurred";
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id
                    ? {
                        ...m,
                        content: m.content || errorMsg,
                        isStreaming: false,
                        phase: "done" as const,
                      }
                    : m,
                ),
              );
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }

      // Ensure streaming is finalized
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id && m.isStreaming
            ? { ...m, isStreaming: false, phase: "done" as const }
            : m,
        ),
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? {
                ...m,
                content: m.content || t("chat.errorFallback"),
                isStreaming: false,
                phase: "done" as const,
              }
            : m,
        ),
      );
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  return (
    <main className="flex flex-1 h-screen overflow-hidden">
      {/* Conversation sidebar */}
      <aside className="w-64 border-r flex-col hidden md:flex bg-background">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="font-semibold text-sm">{t("chat.conversations")}</h2>
          <Button size="icon-xs" variant="ghost" onClick={startNewConversation}>
            <Plus className="size-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.map((c) => (
            <div
              key={c.id}
              className={cn(
                "group flex items-center gap-1 rounded-md transition-colors hover:bg-accent/50",
                conversationId === c.id && "bg-accent",
              )}
            >
              <button
                onClick={() => loadConversation(c.id)}
                className="flex-1 text-left px-3 py-2 min-w-0"
              >
                <p className="truncate text-sm font-medium">
                  {c.title || t("chat.newConversation")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(c.updated_at, t)}
                </p>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deleteConversation(c.id);
                }}
                className="p-1.5 mr-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/10 transition-opacity"
                title="Delete"
              >
                <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
              </button>
            </div>
          ))}
          {conversations.length === 0 && (
            <p className="text-xs text-muted-foreground px-3 py-2">
              {t("chat.noHistory")}
            </p>
          )}
        </div>
      </aside>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div
          className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4"
          ref={scrollRef}
        >
          {messages.length === 0 && <EmptyChat />}
          {messages.map((m) => (
            <ChatMessageBubble key={m.id} message={m} />
          ))}
        </div>

        <div className="border-t p-4">
          <div className="max-w-3xl mx-auto">
            <ChatInput
              onSend={handleSend}
              onStop={handleStop}
              isStreaming={isStreaming}
            />
          </div>
        </div>
      </div>
    </main>
  );
}

function EmptyChat() {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <div className="size-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
        <MessageSquare className="size-8 text-primary" />
      </div>
      <h2 className="text-xl font-semibold mb-2">{t("chat.emptyTitle")}</h2>
      <p className="text-sm text-muted-foreground max-w-sm">
        {t("chat.emptySubtitle")}
      </p>
    </div>
  );
}
