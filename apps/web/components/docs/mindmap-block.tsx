"use client";

import * as React from "react";
import type { MindElixirData, MindElixirInstance, Operation, Theme } from "mind-elixir";
import { en as meEn, ko as meKo, ja as meJa, zh_CN as meZh } from "mind-elixir/i18n";
import "mind-elixir/style.css";
import { createReactBlockSpec } from "@blocknote/react";
import { useI18nStore, useTranslation } from "@/lib/i18n";

// ── Project theme — mirrors mindmap-editor.tsx PROJECT_THEME ────────────────
// Duplicated here so mindmap-block is fully self-contained; if you later want
// to share, export PROJECT_THEME from mindmap-editor.tsx and import it here.
const PROJECT_THEME: Theme = {
  name: "project",
  palette: ["#4f46e5", "#6366f1", "#7c3aed", "#2563eb", "#0ea5e9", "#8b5cf6"],
  cssVar: {
    "--root-color": "var(--primary-foreground)",
    "--root-bgcolor": "var(--primary)",
    "--main-color": "var(--card-foreground)",
    "--main-bgcolor": "var(--card)",
    "--color": "var(--card-foreground)",
    "--bgcolor": "var(--muted)",
    "--selected": "var(--ring)",
    "--main-border": "1px solid var(--border)",
  },
};

const ME_LOCALE: Record<string, typeof meEn> = { en: meEn, ko: meKo, ja: meJa, zh: meZh };

// ── Block config ─────────────────────────────────────────────────────────────

const MINDMAP_BLOCK_CONFIG = {
  type: "mindmap" as const,
  content: "none" as const,
  propSchema: {
    data: { default: "" as string },
  },
};

// ── Block render component ───────────────────────────────────────────────────

function MindmapBlockView({
  block,
  editor,
}: {
  block: { id: string; type: "mindmap"; props: { data: string } };
  editor: { isEditable: boolean; updateBlock: (block: { id: string }, update: { props: Partial<{ data: string }> }) => void };
}) {
  const { t } = useTranslation();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mindRef = React.useRef<MindElixirInstance | null>(null);
  // Track the last JSON we applied so we can skip feedback loops
  const lastJsonRef = React.useRef<string>(block.props.data);
  // Debounce timer for propagating local changes back to the block prop
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Whether this update originated from us (to avoid re-applying our own write)
  const updatingRef = React.useRef(false);

  // ── Initialise mind-elixir on mount ─────────────────────────────────────
  React.useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    const initMind = async () => {
      const MindElixir = (await import("mind-elixir")).default;
      if (disposed || !containerRef.current) return;

      // Determine seed data: parse stored JSON or fall back to empty root
      const defaultTopic = t("mindmap.blockDefaultTopic");
      let seedData: MindElixirData;
      try {
        seedData = block.props.data
          ? (JSON.parse(block.props.data) as MindElixirData)
          : { nodeData: { id: "root", topic: defaultTopic } };
      } catch {
        seedData = { nodeData: { id: "root", topic: defaultTopic } };
      }

      const locale = useI18nStore.getState().locale;

      const mind = new MindElixir({
        el: containerRef.current!,
        direction: (seedData.direction as 0 | 1 | 2) ?? MindElixir.SIDE,
        editable: editor.isEditable,
        draggable: editor.isEditable,
        contextMenu: { locale: ME_LOCALE[locale] ?? meEn },
        toolBar: true,
        keypress: editor.isEditable,
        allowUndo: editor.isEditable,
      });

      mind.init(seedData);
      mind.changeTheme(PROJECT_THEME, true);
      mindRef.current = mind;
      lastJsonRef.current = block.props.data;

      // ── Persist local edits back to block prop (debounced) ───────────────
      mind.bus.addListener("operation", (_op: Operation) => {
        if (!editor.isEditable) return;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          if (!mindRef.current) return;
          const json = JSON.stringify(mindRef.current.getData());
          if (json === lastJsonRef.current) return; // nothing changed
          lastJsonRef.current = json;
          updatingRef.current = true;
          editor.updateBlock(block, { props: { data: json } });
          // updatingRef stays true until the next render cycle resets it in
          // the collab-sync effect (see below).
        }, 400);
      });
    };

    void initMind();

    return () => {
      disposed = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (mindRef.current) {
        mindRef.current.destroy();
        mindRef.current = null;
      }
    };
    // Run only on mount; collab prop changes are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync incoming prop changes (collab / remote updates) ─────────────────
  React.useEffect(() => {
    // If *we* triggered this update, don't re-apply it to the canvas.
    if (updatingRef.current) {
      updatingRef.current = false;
      return;
    }

    const incoming = block.props.data;
    if (!incoming || incoming === lastJsonRef.current) return;
    if (!mindRef.current) return;

    try {
      const parsed = JSON.parse(incoming) as MindElixirData;
      lastJsonRef.current = incoming;
      mindRef.current.refresh(parsed);
      mindRef.current.changeTheme(PROJECT_THEME, true);
    } catch {
      // Ignore malformed payloads
    }
  }, [block.props.data]);

  return (
    <div
      // Prevent BlockNote from capturing keyboard / pointer events inside the canvas
      contentEditable={false}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className="relative w-full h-[420px] rounded-md border bg-background overflow-hidden"
    >
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}

// ── Exported block spec ──────────────────────────────────────────────────────
// createReactBlockSpec returns a factory function; call it once here to get
// the resolved BlockSpec that BlockNoteSchema.create() consumes.
export const mindmapBlockSpec = createReactBlockSpec(MINDMAP_BLOCK_CONFIG, {
  render: MindmapBlockView as React.FC<{
    block: { id: string; type: "mindmap"; props: { data: string } };
    editor: { isEditable: boolean; updateBlock: (block: { id: string }, update: { props: Partial<{ data: string }> }) => void };
  }>,
})();
