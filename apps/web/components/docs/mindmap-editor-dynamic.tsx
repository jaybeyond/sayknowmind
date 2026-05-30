"use client";

import dynamic from "next/dynamic";
import type { MindElixirData } from "mind-elixir";

interface MindmapEditorProps {
  docId: string;
  initialTitle: string;
  initialData: MindElixirData | null;
  collab?: boolean;
  onBack?: () => void;
}

const MindmapEditorInner = dynamic<MindmapEditorProps>(
  () => import("./mindmap-editor").then((m) => m.MindmapEditor),
  { ssr: false },
);

export function MindmapEditorDynamic(props: MindmapEditorProps) {
  return <MindmapEditorInner {...props} />;
}
