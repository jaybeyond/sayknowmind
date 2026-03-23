"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Plus, MessageSquare } from "lucide-react";
import { ChatMessageBubble, type ChatMessage, type Citation } from "./chat-message";
import { ChatInput } from "./chat-input";
import type { AgentStep } from "./agent-steps";
import { useTranslation } from "@/lib/i18n";

type ConversationMeta = {
  id: string;
  title: string;
  updatedAt: string;
};

function formatDate(
  dateStr: string,
  t: (key: string) => string
): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return t("chat.today");
  if (diffDays === 1) return t("chat.yesterday");
  if (diffDays < 7) return t("chat.daysAgo").replace("{{days}}", String(diffDays));
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ChatPage() {
  const { t } = useTranslation();
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [mode, setMode] = React.useState<"simple" | "agentic">("simple");
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const [conversations, setConversations] = React.useState<ConversationMeta[]>([]);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

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
    setMessages([]);
  };

  const handleSend = async (message: string) => {
    if (!message.trim() || isStreaming) return;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", content: message };
    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      isStreaming: true,
      citations: [],
      agentSteps: [],
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (mode === "agentic") {
        await handleAgenticSend(message, assistantMsg.id, controller.signal);
      } else {
        await handleStreamingSend(message, assistantMsg.id, controller.signal);
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, content: m.content || t("chat.errorFallback"), isStreaming: false }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const handleStreamingSend = async (
    message: string,
    assistantId: string,
    signal: AbortSignal
  ) => {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ message, conversationId, mode }),
      signal,
    });

    if (!response.ok) throw new Error(`Chat request failed: ${response.status}`);

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

          if (event.type === "chunk" || event.chunk) {
            const chunkText = event.content ?? event.chunk ?? "";
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + chunkText } : m
              )
            );
          } else if (event.type === "citation") {
            const citations: Citation[] = event.citations ?? [];
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, citations } : m))
            );
          } else if (event.type === "agent_step") {
            const step: AgentStep = event.step;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, agentSteps: [...(m.agentSteps ?? []), step] }
                  : m
              )
            );
          } else if (event.type === "done" || event.done) {
            const newConvId = event.conversationId;
            if (newConvId) {
              setConversationId(newConvId);
              updateConversationsList(newConvId, messages);
            }
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m))
            );
          } else if (event.type === "error" || event.error) {
            const errorMsg = event.message ?? event.error ?? t("common.error");
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: m.content || errorMsg, isStreaming: false }
                  : m
              )
            );
          }
        } catch {
          // Skip malformed JSON lines
        }
      }
    }

    setMessages((prev) =>
      prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m))
    );
  };

  const handleAgenticSend = async (
    message: string,
    assistantId: string,
    signal: AbortSignal
  ) => {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, conversationId, mode: "agentic" }),
      signal,
    });

    if (!response.ok) throw new Error(`Chat request failed: ${response.status}`);

    const data = await response.json();

    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId
          ? {
              ...m,
              content: data.answer ?? "",
              isStreaming: false,
              citations: data.citations ?? [],
              agentSteps: data.agentSteps ?? [],
            }
          : m
      )
    );

    if (data.conversationId) {
      setConversationId(data.conversationId);
      updateConversationsList(data.conversationId, messages);
    }
  };

  const updateConversationsList = (convId: string, currentMessages: ChatMessage[]) => {
    setConversations((prev) => {
      const existing = prev.find((c) => c.id === convId);
      if (existing) {
        return prev.map((c) =>
          c.id === convId ? { ...c, updatedAt: new Date().toISOString() } : c
        );
      }
      const firstUserMsg = currentMessages.find((m) => m.role === "user");
      return [
        {
          id: convId,
          title: firstUserMsg?.content.slice(0, 60) ?? t("chat.newConversation"),
          updatedAt: new Date().toISOString(),
        },
        ...prev,
      ];
    });
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
            <button
              key={c.id}
              onClick={() => loadConversation(c.id)}
              className={cn(
                "w-full text-left px-3 py-2 rounded-md text-sm transition-colors hover:bg-accent/50",
                conversationId === c.id && "bg-accent"
              )}
            >
              <p className="truncate font-medium">{c.title || t("chat.newConversation")}</p>
              <p className="text-xs text-muted-foreground">{formatDate(c.updatedAt, t)}</p>
            </button>
          ))}
          {conversations.length === 0 && (
            <p className="text-xs text-muted-foreground px-3 py-2">{t("chat.noHistory")}</p>
          )}
        </div>
      </aside>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4" ref={scrollRef}>
          {messages.length === 0 && <EmptyChat />}
          {messages.map((m) => (
            <ChatMessageBubble key={m.id} message={m} />
          ))}
        </div>

        <div className="border-t p-4">
          <div className="max-w-3xl mx-auto">
            <ChatInput
              onSend={handleSend}
              isDisabled={isStreaming}
              mode={mode}
              onModeChange={setMode}
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
      <p className="text-sm text-muted-foreground max-w-sm">{t("chat.emptySubtitle")}</p>
    </div>
  );
}
