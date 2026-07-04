"use client";

import { useEffect } from "react";

/**
 * Preloads the heavy code-split editor chunks while the browser is idle, so
 * the FIRST open of a doc / mind map / knowledge graph / sheet doesn't stall
 * on a multi-megabyte download+parse. That download was the "first click is
 * slow, second is instant" symptom — the second click was simply hitting the
 * module cache. In dev this also triggers the on-demand compile of those
 * modules in the background, which fixes the same symptom there.
 *
 * Ordered by likelihood of use and spaced out so warmup never competes with
 * the page's own startup work (data fetches, first paint). Each import is
 * idempotent — if the user opens an editor before its slot, the click's own
 * import wins and the warmup becomes a no-op. Skipped entirely when the user
 * asked the browser to save data.
 */
export function ChunkWarmup() {
  useEffect(() => {
    const conn = (navigator as { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;

    const timers: ReturnType<typeof setTimeout>[] = [];
    const schedule = (delayMs: number, load: () => Promise<unknown>) => {
      timers.push(
        setTimeout(() => {
          const idle =
            typeof window.requestIdleCallback === "function"
              ? (cb: () => void) => window.requestIdleCallback(cb, { timeout: 10_000 })
              : (cb: () => void) => setTimeout(cb, 0);
          idle(() => {
            void load().catch(() => {});
          });
        }, delayMs),
      );
    };

    schedule(3_000, () => import("@/components/docs/doc-tabs")); // BlockNote/ProseMirror doc editor
    schedule(7_000, () => import("@/components/docs/mindmap-editor")); // mind-elixir
    schedule(11_000, () => import("@/components/knowledge/graph-canvas")); // force-graph
    // The sheet engine is lazy-imported INSIDE office-tab's mount effect, so
    // warming the wrapper alone wouldn't touch the ~5MB Univer chunk — import
    // the presets themselves (module evaluation only; nothing renders until
    // office-tab calls createUniver).
    schedule(16_000, () => import("@/components/docs/office-tab"));
    schedule(20_000, () =>
      Promise.all([import("@univerjs/presets"), import("@univerjs/preset-sheets-core")]),
    );

    return () => timers.forEach(clearTimeout);
  }, []);

  return null;
}
