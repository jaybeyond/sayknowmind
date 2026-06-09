"use client";

import * as React from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import type { Block } from "@blocknote/core";
import { en as bnEn, ko as bnKo, ja as bnJa, zh as bnZh } from "@blocknote/core/locales";
import { useTheme } from "next-themes";
import { DocEditor } from "./doc-editor";
import { useTranslation, useI18nStore } from "@/lib/i18n";
import { SummaryButton } from "./summary-button";

// Built-in BlockNote UI dictionaries (slash menu, placeholders, formatting
// toolbar, etc.), keyed by our app locales. Falls back to English.
const BN_LOCALE = { en: bnEn, ko: bnKo, ja: bnJa, zh: bnZh } as const;

interface DocEditorCollabProps {
  docId: string;
  initialTitle: string;
  initialBlocks: Block[] | null;
}

interface CollabSession {
  token: string;
  wsUrl: string;
  canWrite: boolean;
  user: { name: string; color: string };
}

/**
 * Collaboration entry point. Fetches a doc-scoped collab token; if collab is
 * unconfigured/unavailable it transparently falls back to the single-user
 * editor (P1) so authoring always works. Once a session is in hand it mounts
 * the real-time editor.
 */
export function DocEditorCollab({ docId, initialTitle, initialBlocks }: DocEditorCollabProps) {
  const { t } = useTranslation();
  const [state, setState] = React.useState<
    { kind: "loading" } | { kind: "fallback" } | { kind: "ready"; session: CollabSession }
  >({ kind: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/documents/${docId}/collab-token`, { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setState({ kind: "fallback" });
          return;
        }
        const session = (await res.json()) as CollabSession;
        if (!session.token || !session.wsUrl) {
          if (!cancelled) setState({ kind: "fallback" });
          return;
        }
        if (!cancelled) setState({ kind: "ready", session });
      } catch {
        if (!cancelled) setState({ kind: "fallback" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docId]);

  if (state.kind === "loading") {
    return (
      <div className="max-w-3xl mx-auto py-10 px-4 text-sm text-muted-foreground">{t("docs.connecting")}</div>
    );
  }

  if (state.kind === "fallback") {
    return <DocEditor docId={docId} initialTitle={initialTitle} initialBlocks={initialBlocks} />;
  }

  return (
    <CollabEditorInner
      docId={docId}
      initialTitle={initialTitle}
      initialBlocks={initialBlocks}
      session={state.session}
    />
  );
}

type SaveStatus = "saved" | "saving" | "unsaved";
const AUTOSAVE_DEBOUNCE_MS = 800;

function blocksToPlaintext(blocks: Block[]): string {
  return blocks
    .map((b) => {
      const content = b.content;
      if (!Array.isArray(content)) return "";
      return content
        .map((inline) =>
          typeof inline === "object" && inline !== null && "text" in inline
            ? String((inline as { text: string }).text)
            : "",
        )
        .join("");
    })
    .filter(Boolean)
    .join("\n");
}

function CollabEditorInner({
  docId,
  initialTitle,
  initialBlocks,
  session,
}: DocEditorCollabProps & { session: CollabSession }) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const [title, setTitle] = React.useState(initialTitle);
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>("saved");
  const [connected, setConnected] = React.useState(false);
  const [peers, setPeers] = React.useState(1);
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const seeded = React.useRef(false);
  const dirtyRef = React.useRef(false);
  // True once the editor has loaded its content (synced from a peer OR seeded
  // from the at-rest blocks). Saving is blocked until then so an empty,
  // not-yet-loaded editor can never overwrite the stored content — important
  // when the collab WS is offline and `synced` never fires.
  const readyRef = React.useRef(false);

  // One Y.Doc + provider for the lifetime of this editor. The room name is the
  // doc id; the token authorizes exactly that room.
  const { ydoc, provider } = React.useMemo(() => {
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: session.wsUrl,
      name: docId,
      token: session.token,
      document: ydoc,
    });
    return { ydoc, provider };
  }, [docId, session.wsUrl, session.token]);

  const editor = useCreateBlockNote({
    dictionary: BN_LOCALE[useI18nStore.getState().locale] ?? bnEn,
    collaboration: {
      fragment: ydoc.getXmlFragment("document"),
      user: session.user,
      provider: { awareness: provider.awareness ?? undefined },
    },
  });

  // Connection + presence indicators.
  React.useEffect(() => {
    // Seed a brand-new (empty) doc from the at-rest block JSON, then mark the
    // editor ready so autosave can begin.
    const seedAndReady = () => {
      if (!seeded.current) {
        seeded.current = true;
        if (
          session.canWrite &&
          initialBlocks &&
          initialBlocks.length > 0 &&
          ydoc.getXmlFragment("document").length === 0
        ) {
          editor.replaceBlocks(editor.document, initialBlocks);
        }
      }
      readyRef.current = true;
    };

    const onStatus = (e: { status: string }) => setConnected(e.status === "connected");
    const onSynced = () => {
      setConnected(true);
      seedAndReady();
    };
    provider.on("status", onStatus);
    provider.on("synced", onSynced);

    // Offline fallback: if `synced` hasn't fired (WS unreachable), load the
    // content locally so editing/saving works without collaboration. Kept short
    // so docs appear fast when collab isn't connected; a working local relay
    // syncs well under this, so there's no double-seed.
    const offlineSeed = setTimeout(() => {
      if (!readyRef.current) seedAndReady();
    }, 500);

    const awareness = provider.awareness;
    const onAwareness = () => setPeers(awareness ? awareness.getStates().size : 1);
    awareness?.on("change", onAwareness);
    onAwareness();

    return () => {
      clearTimeout(offlineSeed);
      provider.off("status", onStatus);
      provider.off("synced", onSynced);
      awareness?.off("change", onAwareness);
    };
  }, [provider, ydoc, editor, initialBlocks, session.canWrite]);

  React.useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      // Index the latest content for RAG (summary + embedding) when leaving.
      if (dirtyRef.current && typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(`/api/documents/${docId}/process`);
        dirtyRef.current = false;
      }
      provider.destroy();
      ydoc.destroy();
    };
  }, [provider, ydoc, docId]);

  // Persist the searchable at-rest projection (content + block JSON). Writable
  // clients debounce-save; the live Yjs CRDT remains the source of truth.
  const persist = React.useCallback(
    async (titleValue: string, blocks: Block[]) => {
      setSaveStatus("saving");
      try {
        await fetch(`/api/documents/${docId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: titleValue,
            content: blocksToPlaintext(blocks),
            metadata: { blocknote: blocks, content_format: "blocknote" },
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
    (titleValue: string, blocks: Block[]) => {
      if (!session.canWrite || !readyRef.current) return;
      setSaveStatus("unsaved");
      dirtyRef.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void persist(titleValue, blocks), AUTOSAVE_DEBOUNCE_MS);
    },
    [persist, session.canWrite],
  );

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setTitle(next);
    scheduleAutosave(next, editor.document);
  };

  return (
    <div className="flex flex-col gap-4 max-w-3xl mx-auto py-10 px-4">
      <div className="flex items-center justify-between gap-4">
        <input
          type="text"
          value={title}
          onChange={handleTitleChange}
          placeholder={t("docs.untitled")}
          readOnly={!session.canWrite}
          className="flex-1 text-3xl font-bold bg-transparent border-none outline-none placeholder:text-muted-foreground"
        />
        <SummaryButton docId={docId} />
        <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
          {connected && (
            <span title={t("docs.live")}>
              ● {t("docs.online").replace("{count}", String(peers))}
            </span>
          )}
          {session.canWrite ? (
            <span>{saveStatus === "saving" ? t("docs.saving") : saveStatus === "unsaved" ? t("docs.unsaved") : t("docs.saved")}</span>
          ) : (
            <span>{t("docs.readOnly")}</span>
          )}
        </div>
      </div>

      <BlockNoteView
        editor={editor}
        editable={session.canWrite}
        onChange={() => scheduleAutosave(title, editor.document)}
        theme={resolvedTheme === "dark" ? "dark" : "light"}
      />
    </div>
  );
}
