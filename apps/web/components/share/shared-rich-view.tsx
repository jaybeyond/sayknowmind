"use client";

// Read-only renderer for shared rich documents on the public /s/[token] page.
// Reuses the real editors (BlockNote, Univer, mind-elixir) in non-editable mode
// so a shared note / spreadsheet / mind map looks exactly like it does in-app.
// Heavy editors are lazy-loaded so the public page only pulls them when the
// shared item actually needs them.

import * as React from "react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { docSchema, type DocBlock } from "@/components/docs/doc-schema";
import { SharedSheetTable } from "@/components/share/shared-sheet-table";

interface DocTab {
  id: string;
  name: string;
  kind?: "blocknote" | "sheet";
  html?: string;
}
interface DocTabsData {
  tabs: DocTab[];
  blocks?: Record<string, DocBlock[]>;
  univer?: Record<string, unknown>;
}

export interface SharedRichViewProps {
  sourceType?: string;
  docTabs?: DocTabsData;
  mindmap?: unknown;
}

/** True when there is rich editor state worth rendering (vs. plain text). */
export function hasRichContent(p: SharedRichViewProps): boolean {
  if (p.sourceType === "mindmap") return !!p.mindmap;
  if (p.sourceType === "doc" || p.sourceType === "sheet") {
    return Array.isArray(p.docTabs?.tabs) && (p.docTabs?.tabs.length ?? 0) > 0;
  }
  return false;
}

// ── BlockNote (read-only) ─────────────────────────────────────────────────────

function ReadOnlyBlockNote({ blocks }: { blocks: DocBlock[] }) {
  const editor = useCreateBlockNote({
    schema: docSchema,
    initialContent: blocks.length > 0 ? (blocks as any) : undefined,
  });
  return <BlockNoteView editor={editor} editable={false} slashMenu={false} />;
}

// ── mind-elixir (read-only) ───────────────────────────────────────────────────

function ReadOnlyMindmap({ data }: { data: any }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    let disposed = false;
    const el = ref.current;
    (async () => {
      const MindElixir = (await import("mind-elixir")).default;
      if (disposed || !ref.current) return;
      const seed =
        data && typeof data === "object" && (data as any).nodeData
          ? (data as any)
          : { nodeData: { id: "root", topic: "" } };
      const mind = new MindElixir({
        el: ref.current,
        direction: (seed.direction as 0 | 1 | 2) ?? MindElixir.SIDE,
        editable: false,
        draggable: false,
        contextMenu: false,
        toolBar: true,
        keypress: false,
        allowUndo: false,
      });
      mind.init(seed);
    })();
    return () => {
      disposed = true;
      if (el) el.innerHTML = "";
    };
  }, [data]);
  return <div ref={ref} className="w-full h-[70vh] min-h-[400px]" />;
}

// ── Tabbed doc / sheet ────────────────────────────────────────────────────────

function SharedDocTabs({ data }: { data: DocTabsData }) {
  const tabs = data.tabs ?? [];
  const [activeId, setActiveId] = React.useState(tabs[0]?.id);
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];
  if (!active) return null;

  return (
    <div className="w-full">
      {tabs.length > 1 && (
        <div className="flex flex-wrap gap-1 mb-4 border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveId(tab.id)}
              className={`px-3 py-1.5 text-sm -mb-px border-b-2 transition-colors ${
                active.id === tab.id
                  ? "border-primary text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.name}
            </button>
          ))}
        </div>
      )}

      {active.html ? (
        <iframe
          title={active.name}
          srcDoc={active.html}
          sandbox="allow-scripts allow-popups allow-forms allow-modals"
          referrerPolicy="no-referrer"
          className="w-full h-[70vh] min-h-[400px] border-0 bg-white rounded-md"
        />
      ) : active.kind === "sheet" ? (
        <SharedSheetTable snapshot={data.univer?.[active.id] ?? null} />
      ) : (
        <ReadOnlyBlockNote key={active.id} blocks={data.blocks?.[active.id] ?? []} />
      )}
    </div>
  );
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

export function SharedRichView({ sourceType, docTabs, mindmap }: SharedRichViewProps) {
  if (sourceType === "mindmap" && mindmap) return <ReadOnlyMindmap data={mindmap} />;
  if ((sourceType === "doc" || sourceType === "sheet") && docTabs?.tabs?.length) {
    return <SharedDocTabs data={docTabs} />;
  }
  return null;
}
