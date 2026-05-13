"use client";

import { useEffect } from "react";
import { startRelayWorker, stopRelayWorker } from "@/lib/llm-relay/worker";

/**
 * Mounts the LLM relay long-poll worker once per webview. The worker
 * is a no-op outside Tauri (no __TAURI_INTERNALS__), so this component
 * is also safe to render on the public marketing site or in a browser
 * tab that has no local OCP/Codex.
 *
 * Keep this in the root layout so the relay survives navigation between
 * /chat, /dashboard, /settings — the cloud may need to call the user's
 * local LLM from any server-side flow (chat pipeline, ingest job
 * queue, Telegram webhook).
 */
export function LlmRelayRunner() {
  useEffect(() => {
    startRelayWorker();
    return () => {
      // Don't stop on unmount in dev (React StrictMode mounts twice).
      // The worker is process-singleton so leaving it running across
      // remounts is the correct behaviour. On real navigation away
      // from the page the worker stays running too — that's fine
      // because Tauri keeps the webview alive.
    };
  }, []);

  // Sentinel for any future debug overlays; nothing visible by default.
  return null;
}

/**
 * Imperative stop — wired into logout / app shutdown if needed. Most
 * callers don't need this; expose it for completeness.
 */
export function stopLlmRelay(): void {
  stopRelayWorker();
}
