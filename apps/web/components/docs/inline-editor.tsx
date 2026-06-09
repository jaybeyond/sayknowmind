"use client";

import * as React from "react";
import { ChevronLeft } from "lucide-react";
import type { MindElixirData } from "mind-elixir";
import { useMemoryStore } from "@/store/memory-store";
import { useTranslation } from "@/lib/i18n";
import type { DocEditorDynamicProps } from "./doc-editor-dynamic";
import { DocEditorDynamic } from "./doc-editor-dynamic";
import { MindmapEditorDynamic } from "./mindmap-editor-dynamic";

interface InlineEditorProps {
  type: "doc" | "mindmap";
  id: string;
}

interface DocPayload {
  id: string;
  title: string;
  content: string;
  source_type: string;
  metadata: Record<string, unknown>;
}

/**
 * Renders a doc / mind-map editor in place inside the content area (instead of
 * navigating to a separate page). Fetches the document client-side, shapes the
 * editor's initial data the same way the standalone pages do, and offers a
 * "back" affordance that returns to the memory list via the store.
 */
export function InlineEditor({ type, id }: InlineEditorProps) {
  const { t } = useTranslation();
  const setOpenEditor = useMemoryStore((s) => s.setOpenEditor);
  const [doc, setDoc] = React.useState<DocPayload | null>(null);
  const [status, setStatus] = React.useState<"loading" | "error" | "ready">("loading");

  React.useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setDoc(null);
    fetch(`/api/documents/${id}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<DocPayload>) : null))
      .then((d) => {
        if (cancelled) return;
        if (d) {
          setDoc(d);
          setStatus("ready");
        } else {
          setStatus("error");
        }
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const backBar = (
    <div className="shrink-0 border-b px-3 py-2">
      <button
        onClick={() => setOpenEditor(null)}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronLeft className="size-4" />
        {t("docs.backToList")}
      </button>
    </div>
  );

  let body: React.ReactNode;
  if (status === "loading") {
    body = (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("docs.connecting")}
      </div>
    );
  } else if (status === "error" || !doc) {
    body = (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        {t("emptyState.search")}
      </div>
    );
  } else if (type === "mindmap") {
    const mindmapData: MindElixirData | null =
      doc.metadata?.mindmap != null &&
      typeof doc.metadata.mindmap === "object" &&
      "nodeData" in (doc.metadata.mindmap as object)
        ? (doc.metadata.mindmap as MindElixirData)
        : null;
    body = (
      <div className="flex-1 overflow-hidden">
        <MindmapEditorDynamic
          docId={doc.id}
          initialTitle={doc.title}
          initialData={mindmapData}
          collab={!!process.env.NEXT_PUBLIC_COLLAB_WS_URL}
          onBack={() => setOpenEditor(null)}
        />
      </div>
    );
  } else {
    const editorProps: DocEditorDynamicProps = {
      docId: doc.id,
      initialTitle: doc.title,
      initialMetadata: doc.metadata,
      collab: !!process.env.NEXT_PUBLIC_COLLAB_WS_URL,
      onBack: () => setOpenEditor(null),
    };
    body = (
      <div className="flex-1 min-h-0 overflow-hidden">
        <DocEditorDynamic {...editorProps} />
      </div>
    );
  }

  // The mind-map and document editors render their own header (with a back
  // button), so skip the standalone back bar there to avoid stacking headers.
  const hideBackBar =
    status === "ready" && (type === "mindmap" || type === "doc");

  return (
    <div className="flex flex-col h-full w-full">
      {!hideBackBar && backBar}
      {body}
    </div>
  );
}
