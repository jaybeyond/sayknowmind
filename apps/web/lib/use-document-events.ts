"use client";

import { useEffect, useRef } from "react";
import { useMemoryStore } from "@/store/memory-store";

/**
 * Hook that subscribes to the SSE stream at /api/events/stream.
 * When a document is created or ingest completes, triggers a store refresh.
 * Auto-reconnects on disconnect with exponential backoff.
 */
export function useDocumentEvents() {
  const fetchMemories = useMemoryStore((s) => s.fetchMemories);
  const retryRef = useRef(0);

  useEffect(() => {
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      es = new EventSource("/api/events/stream");

      es.onopen = () => {
        retryRef.current = 0; // Reset backoff on successful connection
      };

      // Refresh store when a new doc is created (shows as "processing")
      es.addEventListener("document:created", () => {
        fetchMemories();
      });

      // Refresh store when ingest finishes (shows AI summary, tags, category)
      es.addEventListener("ingest:completed", () => {
        fetchMemories();
      });

      // Also refresh on failure so the UI shows the failed status
      es.addEventListener("ingest:failed", () => {
        fetchMemories();
      });

      es.onerror = () => {
        es?.close();
        // Reconnect with exponential backoff (1s, 2s, 4s, 8s, max 30s)
        const delay = Math.min(1000 * Math.pow(2, retryRef.current), 30_000);
        retryRef.current++;
        timer = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      es?.close();
      if (timer) clearTimeout(timer);
    };
  }, [fetchMemories]);
}
