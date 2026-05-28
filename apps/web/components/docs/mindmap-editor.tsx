"use client";

import * as React from "react";
import type { MindElixirData, MindElixirInstance, Operation } from "mind-elixir";
import "mind-elixir/style.css";

interface MindmapEditorProps {
  docId: string;
  initialTitle: string;
  initialData: MindElixirData | null;
}

type SaveStatus = "saved" | "saving" | "unsaved";

const AUTOSAVE_DEBOUNCE_MS = 800;

function collectTopics(node: MindElixirData["nodeData"]): string[] {
  const topics: string[] = [];
  const walk = (n: typeof node) => {
    if (n.topic) topics.push(n.topic);
    if (n.children) n.children.forEach(walk);
  };
  walk(node);
  return topics;
}

export function MindmapEditor({ docId, initialTitle, initialData }: MindmapEditorProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mindRef = React.useRef<MindElixirInstance | null>(null);
  const [title, setTitle] = React.useState(initialTitle);
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>("saved");
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = React.useCallback(
    async (titleValue: string, data: MindElixirData) => {
      setSaveStatus("saving");
      try {
        const plaintext = collectTopics(data.nodeData).join("\n");
        await fetch(`/api/documents/${docId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: titleValue,
            content: plaintext,
            metadata: {
              mindmap: data,
              content_format: "mindmap",
            },
          }),
        });
        setSaveStatus("saved");
      } catch {
        setSaveStatus("unsaved");
      }
    },
    [docId],
  );

  const scheduleAutosave = React.useCallback(
    (titleValue: string, data: MindElixirData) => {
      setSaveStatus("unsaved");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void persist(titleValue, data);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [persist],
  );

  React.useEffect(() => {
    if (!containerRef.current) return;

    let mind: MindElixirInstance;

    const initMind = async () => {
      const MindElixir = (await import("mind-elixir")).default;

      const seedData: MindElixirData = initialData ?? {
        nodeData: { id: "root", topic: title },
      };

      mind = new MindElixir({
        el: containerRef.current!,
        direction: MindElixir.SIDE,
        editable: true,
        contextMenu: true,
        toolBar: true,
        keypress: true,
        allowUndo: true,
      });

      mind.init(seedData);
      mindRef.current = mind;

      const handleOperation = (_op: Operation) => {
        const data = mind.getData();
        scheduleAutosave(title, data);
      };

      mind.bus.addListener("operation", handleOperation);
    };

    void initMind();

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (mindRef.current) {
        mindRef.current.destroy();
        mindRef.current = null;
      }
    };
    // intentionally no deps — init once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setTitle(next);
    if (mindRef.current) {
      scheduleAutosave(next, mindRef.current.getData());
    }
  };

  React.useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-4 px-4 py-3 border-b shrink-0">
        <input
          type="text"
          value={title}
          onChange={handleTitleChange}
          placeholder="Untitled"
          className="flex-1 text-xl font-bold bg-transparent border-none outline-none placeholder:text-muted-foreground"
        />
        <span className="text-xs text-muted-foreground shrink-0">
          {saveStatus === "saving" ? "Saving…" : saveStatus === "unsaved" ? "Unsaved" : "Saved"}
        </span>
      </div>
      <div ref={containerRef} className="flex-1 w-full" />
    </div>
  );
}
