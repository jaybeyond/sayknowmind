"use client";

import dynamic from "next/dynamic";
import type { DocTabsProps } from "./doc-tabs";

/**
 * Dynamically imports DocTabs (no SSR) so BlockNote + Yjs are only bundled
 * client-side. All doc render paths go through this component.
 */
const DocTabsInner = dynamic<DocTabsProps>(
  () => import("./doc-tabs").then((m) => m.DocTabs),
  { ssr: false },
);

export interface DocEditorDynamicProps {
  docId: string;
  initialTitle: string;
  initialMetadata: Record<string, unknown>;
  /** When true, mount the real-time collaborative editor (falls back to
   *  single-user internally if collab is unavailable). */
  collab?: boolean;
  /** When provided, a back affordance is shown in the doc header. */
  onBack?: () => void;
}

export function DocEditorDynamic({ collab, ...props }: DocEditorDynamicProps) {
  return <DocTabsInner collab={collab ?? false} {...props} />;
}
