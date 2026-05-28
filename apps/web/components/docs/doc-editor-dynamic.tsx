"use client";

import dynamic from "next/dynamic";
import type { Block } from "@blocknote/core";

interface DocEditorProps {
  docId: string;
  initialTitle: string;
  initialBlocks: Block[] | null;
}

const DocEditorInner = dynamic<DocEditorProps>(
  () => import("./doc-editor").then((m) => m.DocEditor),
  { ssr: false },
);

export function DocEditorDynamic(props: DocEditorProps) {
  return <DocEditorInner {...props} />;
}
