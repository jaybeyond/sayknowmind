"use client";

import dynamic from "next/dynamic";
import type { Block } from "@blocknote/core";

interface DocEditorProps {
  docId: string;
  initialTitle: string;
  initialBlocks: Block[] | null;
  /** When true, mount the real-time collaborative editor (which falls back to
   *  the single-user editor internally if collab is unavailable). */
  collab?: boolean;
}

type InnerProps = Omit<DocEditorProps, "collab">;

const DocEditorInner = dynamic<InnerProps>(
  () => import("./doc-editor").then((m) => m.DocEditor),
  { ssr: false },
);

const DocEditorCollabInner = dynamic<InnerProps>(
  () => import("./doc-editor-collab").then((m) => m.DocEditorCollab),
  { ssr: false },
);

export function DocEditorDynamic({ collab, ...props }: DocEditorProps) {
  return collab ? <DocEditorCollabInner {...props} /> : <DocEditorInner {...props} />;
}
