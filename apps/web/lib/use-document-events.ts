"use client";

import { useEffect, useRef } from "react";
import { useMemoryStore } from "@/store/memory-store";

/**
 * Hook that subscribes to the SSE stream at /api/events/stream using fetch.
 * Uses fetch (not EventSource) to avoid browser console ERR_HTTP2_PROTOCOL_ERROR spam.
 * Auto-reconnects on disconnect with exponential backoff.
 */
export function useDocumentEvents() {
  const fetchMemories = useMemoryStore((s) => s.fetchMemories);
  const retryRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    async function connect() {
      if (stopped) return;
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/events/stream", {
          signal: controller.signal,
          headers: { Accept: "text/event-stream" },
        });
        if (!res.ok || !res.body) throw new Error("SSE connect failed");

        retryRef.current = 0; // Reset backoff on successful connection
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!stopped) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("event: document:created") ||
                line.startsWith("event: ingest:completed") ||
                line.startsWith("event: ingest:failed")) {
              fetchMemories();
            }
          }
        }
      } catch {
        // Silently handle — no console errors
      }

      // Reconnect with exponential backoff (2s, 4s, 8s, 16s, max 30s)
      if (!stopped) {
        const delay = Math.min(2000 * Math.pow(2, retryRef.current), 30_000);
        retryRef.current++;
        timer = setTimeout(connect, delay);
      }
    }

    connect();

    return () => {
      stopped = true;
      abortRef.current?.abort();
      if (timer) clearTimeout(timer);
    };
  }, [fetchMemories]);
}
