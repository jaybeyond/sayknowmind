"use client";

import * as React from "react";
import * as Y from "yjs";
import { useTheme } from "next-themes";
import { useI18nStore } from "@/lib/i18n";
import type { OfficeKind } from "./office-shared";

// Enums only — plain values from core, no facade/DI side effects.
import { CommandType, LocaleType } from "@univerjs/core";

// CSS only. The preset *code* is imported lazily inside the effect (see below)
// so the heavy Univer bundle loads only when a sheet tab actually opens.
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/design/lib/index.css";
import "@univerjs/ui/lib/index.css";

// `extractOfficePlaintext` lives in ./office-shared (dependency-free) so doc-tabs
// can project office text into the searchable `content` without pulling Univer.

// App locale (en/ko/ja/zh) → Univer LocaleType.
const APP_TO_UNIVER: Record<string, LocaleType> = {
  en: LocaleType.EN_US,
  ko: LocaleType.KO_KR,
  ja: LocaleType.JA_JP,
  zh: LocaleType.ZH_CN,
};

// Univer locale code per app locale. Static specifiers below keep the bundler happy.
type LocaleCode = "en-US" | "ko-KR" | "ja-JP" | "zh-CN";
const APP_TO_CODE: Record<string, LocaleCode> = {
  en: "en-US",
  ko: "ko-KR",
  ja: "ja-JP",
  zh: "zh-CN",
};

// Lazy locale loaders — explicit static import() per (package, code) so the bundler
// can resolve them. Each module's default export is a Univer locale bundle.
const SHEET_LOCALES: Record<LocaleCode, () => Promise<any>> = {
  "en-US": () => import("@univerjs/preset-sheets-core/locales/en-US"),
  "ko-KR": () => import("@univerjs/preset-sheets-core/locales/ko-KR"),
  "ja-JP": () => import("@univerjs/preset-sheets-core/locales/ja-JP"),
  "zh-CN": () => import("@univerjs/preset-sheets-core/locales/zh-CN"),
};

async function load(loaders: Record<LocaleCode, () => Promise<any>>, code: LocaleCode) {
  try {
    return (await loaders[code]()).default ?? {};
  } catch {
    // Fall back to English if the locale bundle is missing.
    try {
      return (await loaders["en-US"]()).default ?? {};
    } catch {
      return {};
    }
  }
}

// ── Component ────────────────────────────────────────────────────────────────

const AUTOSAVE_DEBOUNCE_MS = 800;

export interface OfficeTabProps {
  /** Stable per-tab id (used as React key by the parent so we remount on switch). */
  tabId: string;
  kind: OfficeKind;
  /** Univer sheet snapshot at rest (IWorkbookData) or null for a fresh workbook. */
  initialSnapshot: unknown | null;
  editable: boolean;
  /** Debounced report of the latest snapshot for persistence. */
  onSnapshotChange: (snapshot: unknown) => void;
  /**
   * Optional collaboration doc. When provided, local Univer mutations are
   * broadcast on a per-tab Yjs op-log and remote mutations are re-applied —
   * best-effort, last-write-wins (Univer OSS has no OT). Snapshot persistence
   * (onSnapshotChange) remains the durable source of truth.
   */
  collabDoc?: Y.Doc | null;
  /**
   * Registers a getter that returns the editor's LIVE snapshot synchronously
   * (used by the toolbar's export action so it captures the latest edits, not
   * the debounced-to-state copy). Called with the getter on mount and `null`
   * on unmount / remount.
   */
  onRegisterSnapshotGetter?: (getter: (() => unknown) | null) => void;
}

/**
 * Mounts a Univer spreadsheet (Excel-like) editor into a container and reports
 * snapshot changes upward for persistence. One Univer instance per tab; disposed
 * on unmount (React 19 StrictMode-safe). The debounce + try/guard mirror
 * mindmap-block so editor churn never floods the autosave.
 */
export default function OfficeTab({ tabId, kind, initialSnapshot, onSnapshotChange, collabDoc, onRegisterSnapshotGetter }: OfficeTabProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();

  // Keep the latest onSnapshotChange without re-running the mount effect.
  const onChangeRef = React.useRef(onSnapshotChange);
  React.useEffect(() => {
    onChangeRef.current = onSnapshotChange;
  }, [onSnapshotChange]);

  // Keep the latest register callback without re-running the mount effect.
  const registerRef = React.useRef(onRegisterSnapshotGetter);
  React.useEffect(() => {
    registerRef.current = onRegisterSnapshotGetter;
  }, [onRegisterSnapshotGetter]);

  // collabDoc is stable for the doc's lifetime; read via ref so it isn't an effect dep.
  const collabRef = React.useRef(collabDoc);
  React.useEffect(() => {
    collabRef.current = collabDoc;
  }, [collabDoc]);

  // Follow the app's dark/light. `darkMode` is passed at CREATION so the render
  // engine paints the canvas "desk" dark from the first frame — toggleDarkMode()
  // after render only themes the DOM and leaves the painted desk white. Because
  // of that, the whole editor REMOUNTS when the theme changes (resolvedTheme is
  // in the mount effect's deps) so the canvas is re-painted in the new theme.
  const apiRef = React.useRef<any>(null);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let disposed = false;
    let disposeFn: (() => void) | null = null;
    let collabCleanup: (() => void) | null = null;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let readyTimer: ReturnType<typeof setTimeout> | null = null;
    const localeKey = useI18nStore.getState().locale ?? "en";
    const code = APP_TO_CODE[localeKey] ?? "en-US";
    const univerLocale = APP_TO_UNIVER[localeKey] ?? LocaleType.EN_US;

    (async () => {
      // Yield a macrotask so React 19 StrictMode's immediate dev re-mount can run
      // its cleanup (setting `disposed`) BEFORE we build Univer — otherwise two
      // instances race and corrupt the shared render engine / DI container.
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (disposed) return;

      let univerAPI: any;
      let getSnapshot: () => any = () => null;

      try {
        // Lazy: only the SHEETS preset (+ its facade) loads for a sheet tab.
        const [{ createUniver, mergeLocales }, { UniverSheetsCorePreset }, sheetLocale] =
          await Promise.all([
            import("@univerjs/presets"),
            import("@univerjs/preset-sheets-core"),
            load(SHEET_LOCALES, code),
          ]);
        if (disposed) return;
        const { univerAPI: api } = createUniver({
          locale: univerLocale,
          // Set dark at creation so the canvas desk paints dark from frame 1.
          darkMode: resolvedTheme === "dark",
          locales: { [univerLocale]: mergeLocales(sheetLocale) },
          presets: [UniverSheetsCorePreset({ container: el })],
        });
        univerAPI = api;
        univerAPI.createWorkbook((initialSnapshot as any) ?? {});
        getSnapshot = () => univerAPI.getActiveWorkbook()?.save() ?? null;
        disposeFn = () => univerAPI.dispose();
      } catch (err) {
        console.error("[office-tab] failed to initialize Univer:", err);
        return;
      }

      if (disposed) {
        const d = disposeFn;
        if (d) setTimeout(() => { try { d(); } catch { /* noop */ } }, 0);
        return;
      }

      // Re-affirm the theme on the DOM side (createUniver's darkMode handled the
      // canvas). Keeps chrome + canvas consistent and ready for live toggles.
      apiRef.current = univerAPI;
      // Expose a synchronous live-snapshot getter for the export action.
      registerRef.current?.(() => {
        try {
          return getSnapshot();
        } catch {
          return null;
        }
      });
      try {
        univerAPI.toggleDarkMode?.(resolvedTheme === "dark");
      } catch {
        /* theme toggle unsupported */
      }

      // Debounced autosave on document mutations only (skip selection/cursor noise).
      const scheduleSave = () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          try {
            const snap = getSnapshot();
            if (snap) onChangeRef.current(snap);
          } catch {
            /* snapshot unavailable */
          }
        }, AUTOSAVE_DEBOUNCE_MS);
      };

      // ── Real-time collaboration (best-effort mutation broadcast) ────────────
      // Univer OSS ships no collaboration, so we mirror its mutation-sync model
      // over the shared Yjs doc: push local MUTATION commands onto a per-tab
      // op-log and re-apply remote ones. No OT transform → last-write-wins.
      const ydoc = collabRef.current;
      // Guard: while applying a remote op we must not re-broadcast it.
      let applyingRemote = false;
      // Don't broadcast the burst of mutations Univer emits while loading the
      // initial snapshot — only stream user edits once things have settled.
      let broadcastReady = false;
      readyTimer = setTimeout(() => {
        broadcastReady = true;
      }, 1200);
      // Unique per-instance origin tag so our OWN Yjs writes are distinguishable
      // from remote ones. CRITICAL: Yjs observers fire for LOCAL transactions too,
      // so without this the observer re-executes our own mutations → infinite loop.
      const localOrigin = { office: tabId };
      let yOps: Y.Array<{ id: string; params: any }> | null = null;
      if (ydoc) {
        yOps = ydoc.getArray<{ id: string; params: any }>(`office-ops:${tabId}`);
        // Skip history: the initial snapshot already reflects prior ops. We only
        // stream deltas from now on (best-effort; a stale snapshot self-heals on
        // the next persisted save).
        let processed = yOps.length;
        const observer = (event: any) => {
          if (!yOps) return;
          // Ignore our own local writes (origin tag) — only apply REMOTE ops.
          if (event?.transaction?.origin === localOrigin) {
            processed = yOps.length;
            return;
          }
          const len = yOps.length;
          if (len <= processed) {
            processed = len; // handle clears/truncation
            return;
          }
          const fresh = yOps.slice(processed);
          processed = len;
          applyingRemote = true;
          try {
            for (const op of fresh) {
              if (!op || typeof op.id !== "string") continue;
              try {
                univerAPI.executeCommand?.(op.id, op.params);
              } catch {
                /* unknown/incompatible mutation — skip */
              }
            }
          } finally {
            applyingRemote = false;
          }
          // Reflect the merged remote state into the persisted snapshot.
          scheduleSave();
        };
        yOps.observe(observer);
        collabCleanup = () => yOps?.unobserve(observer);
      }

      try {
        univerAPI.onCommandExecuted?.((command: any) => {
          if (command?.type !== CommandType.MUTATION) return;
          if (broadcastReady && !applyingRemote && yOps && ydoc && command?.id) {
            try {
              const op = { id: command.id, params: command.params };
              // Tag the transaction with our origin so our own observer skips it.
              ydoc.transact(() => yOps!.push([op]), localOrigin);
            } catch {
              /* non-serializable params — skip broadcast, still save locally */
            }
          }
          scheduleSave();
        });
      } catch {
        /* command hook unavailable */
      }
    })();

    return () => {
      disposed = true;
      apiRef.current = null;
      registerRef.current?.(null);
      if (saveTimer) clearTimeout(saveTimer);
      if (readyTimer) clearTimeout(readyTimer);
      try {
        collabCleanup?.();
      } catch {
        /* observer already removed */
      }
      // Defer disposal: Univer.dispose() synchronously unmounts its internal
      // React root, which throws if called during the parent's render/commit
      // (StrictMode / Fast Refresh). A macrotask moves it safely past commit.
      const d = disposeFn;
      disposeFn = null;
      if (d) setTimeout(() => { try { d(); } catch { /* already torn down */ } }, 0);
    };
    // Remount when kind OR the app theme changes — the latter re-creates Univer
    // with the right `darkMode` so the canvas desk repaints (it can't be retoned
    // live). Other referenced values are intentionally excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, resolvedTheme]);

  return <div ref={containerRef} className="univer-office-host w-full h-full" />;
}
