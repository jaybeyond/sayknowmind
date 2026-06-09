"use client";

import * as React from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { Code2, Eye, Pencil } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

// ── Block config ─────────────────────────────────────────────────────────────
// Stores a raw HTML string in `html`. It renders inside a sandboxed <iframe> so
// the embedded markup's styles/scripts stay isolated from the app and can never
// touch the parent page (no allow-same-origin) — this is the trust boundary for
// pasting arbitrary HTML.

const HTML_BLOCK_CONFIG = {
  type: "html" as const,
  content: "none" as const,
  propSchema: {
    html: { default: "" as string },
  },
};

const IFRAME_SANDBOX = "allow-scripts allow-popups allow-forms allow-modals";

function HtmlBlockView({
  block,
  editor,
}: {
  block: { id: string; type: "html"; props: { html: string } };
  editor: {
    isEditable: boolean;
    updateBlock: (block: { id: string }, update: { props: Partial<{ html: string }> }) => void;
  };
}) {
  const { t } = useTranslation();
  const html = block.props.html;
  // Start in edit mode for an empty, writable block so there's a place to paste.
  const [editing, setEditing] = React.useState(editor.isEditable && !html);
  const [draft, setDraft] = React.useState(html);

  // Keep the draft in sync if the prop changes from a collab peer while we're
  // not actively editing.
  React.useEffect(() => {
    if (!editing) setDraft(block.props.html);
  }, [block.props.html, editing]);

  const commit = () => {
    editor.updateBlock(block, { props: { html: draft } });
    setEditing(false);
  };

  const stop = {
    onPointerDown: (e: React.PointerEvent) => e.stopPropagation(),
    onKeyDown: (e: React.KeyboardEvent) => e.stopPropagation(),
  };

  if (editing) {
    return (
      <div
        contentEditable={false}
        {...stop}
        className="w-full rounded-md border bg-muted/30 p-2"
      >
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("html.placeholder")}
          spellCheck={false}
          className="w-full h-48 resize-y bg-background rounded border p-2 font-mono text-xs outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex justify-end gap-2 mt-2">
          <button
            onClick={commit}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded bg-primary text-primary-foreground hover:opacity-90"
          >
            <Eye className="size-3.5" />
            {t("html.render")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      contentEditable={false}
      {...stop}
      className="group relative w-full resize-y overflow-auto rounded-md border bg-background min-h-[120px] h-[360px]"
    >
      {html ? (
        <iframe
          title={t("html.blockTitle")}
          srcDoc={html}
          sandbox={IFRAME_SANDBOX}
          referrerPolicy="no-referrer"
          className="w-full h-full border-0 bg-white"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {t("html.empty")}
        </div>
      )}
      {editor.isEditable && (
        <button
          onClick={() => {
            setDraft(block.props.html);
            setEditing(true);
          }}
          title={t("html.edit")}
          aria-label={t("html.edit")}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center justify-center size-7 rounded-md border bg-background/90 text-muted-foreground hover:text-foreground"
        >
          <Pencil className="size-3.5" />
        </button>
      )}
    </div>
  );
}

// Icon used by the slash-menu entry (exported so doc-tabs can reuse it).
export const HtmlBlockIcon = Code2;

// ── Exported block spec ──────────────────────────────────────────────────────
// createReactBlockSpec returns a factory; call it once to get the BlockSpec that
// BlockNoteSchema.create() consumes.
export const htmlBlockSpec = createReactBlockSpec(HTML_BLOCK_CONFIG, {
  render: HtmlBlockView as React.FC<{
    block: { id: string; type: "html"; props: { html: string } };
    editor: {
      isEditable: boolean;
      updateBlock: (block: { id: string }, update: { props: Partial<{ html: string }> }) => void;
    };
  }>,
})();
