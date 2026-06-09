"use client";

import * as React from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import {
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { en as bnEn, ko as bnKo, ja as bnJa, zh as bnZh } from "@blocknote/core/locales";
import { Network, Code2, Plus, ChevronLeft, X, FileText, FileSpreadsheet, Download } from "lucide-react";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import { useTranslation, useI18nStore } from "@/lib/i18n";
import { SummaryButton } from "./summary-button";
import { docSchema, type DocBlock } from "./doc-schema";
import { extractOfficePlaintext, isOfficeKind, type OfficeKind } from "./office-shared";

// Heavy Univer office editor — loaded only when an office tab is opened.
const OfficeTab = dynamic(() => import("./office-tab"), { ssr: false });

// Built-in BlockNote UI dictionaries keyed by our app locales. Falls back to English.
const BN_LOCALE = { en: bnEn, ko: bnKo, ja: bnJa, zh: bnZh } as const;

// Slash-menu entries for our custom inline blocks (mindmap, embedded HTML).
// Shared by both the single-user and collab editors so they never diverge.
function customSlashItems(
  editor: any,
  t: (key: string) => string,
) {
  return [
    {
      title: t("mindmap.blockTitle"),
      subtext: t("mindmap.blockSubtext"),
      aliases: ["mindmap", "mind map", "마인드맵", "思维导图", "マインドマップ"],
      group: t("mindmap.blockGroup"),
      icon: <Network size={18} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "mindmap", props: { data: "" } } as any),
    },
    {
      title: t("html.blockTitle"),
      subtext: t("html.blockSubtext"),
      aliases: ["html", "embed", "iframe", "임베드", "嵌入", "埋め込み"],
      group: t("mindmap.blockGroup"),
      icon: <Code2 size={18} />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: "html", props: { html: "" } } as any),
    },
  ];
}

// ── Data model ─────────────────────────────────────────────────────────────

/** A tab is either the default BlockNote rich-text editor or a Univer office editor. */
type TabKind = "blocknote" | OfficeKind;

interface DocTab {
  id: string;
  name: string;
  /** Editor kind. Absent / "blocknote" = the rich-text editor (backward compatible). */
  kind?: TabKind;
  /** When set, the tab renders this raw HTML full-bleed as the whole page
   *  (a sandboxed iframe) instead of the rich-text editor. */
  html?: string;
}

interface DocTabsData {
  tabs: DocTab[];
  blocks: Record<string, DocBlock[]>;
  /** Univer snapshots for office tabs, keyed by tab id (IWorkbookData / IDocumentData / ISlideData). */
  univer?: Record<string, unknown>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

type SaveStatus = "saved" | "saving" | "unsaved";
const AUTOSAVE_DEBOUNCE_MS = 800;
const COLLAB_TOKEN_REQUEST_TIMEOUT_MS = 3500;
const COLLAB_TOKEN_REFRESH_SKEW_MS = 60_000;
const COLLAB_RECONNECT_BASE_DELAY_MS = 1000;
const COLLAB_RECONNECT_MAX_DELAY_MS = 30_000;
const HOCUSPOCUS_UNAUTHORIZED_CLOSE_CODE = 4401;

/** Extract plain text from a DocBlock[] for search / RAG. */
function blocksToPlaintext(blocks: DocBlock[]): string {
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

/**
 * Derive initial docTabs from raw document metadata, migrating legacy
 * `metadata.blocknote` if no `docTabs` key is present yet.
 */
function deriveInitialDocTabs(
  metadata: Record<string, unknown>,
  defaultTabName: string,
): DocTabsData {
  const raw = metadata.docTabs;
  if (
    raw &&
    typeof raw === "object" &&
    Array.isArray((raw as DocTabsData).tabs) &&
    (raw as DocTabsData).tabs.length > 0
  ) {
    const data = raw as DocTabsData;
    return { tabs: data.tabs, blocks: data.blocks ?? {}, univer: data.univer ?? {} };
  }
  // Migration: synthesize a single tab from the legacy blocknote field.
  const legacyBlocks = Array.isArray(metadata.blocknote) ? (metadata.blocknote as DocBlock[]) : [];
  const id = crypto.randomUUID();
  return {
    tabs: [{ id, name: defaultTabName }],
    blocks: { [id]: legacyBlocks },
    univer: {},
  };
}

/** Aggregate searchable plaintext across all tabs (BlockNote blocks + office snapshots). */
function aggregatePlaintext(
  currentTabs: DocTab[],
  blocks: Record<string, DocBlock[]>,
  univer: Record<string, unknown>,
): string {
  return currentTabs
    .map((tab) =>
      isOfficeKind(tab.kind)
        ? extractOfficePlaintext(tab.kind, univer[tab.id] ?? null)
        : blocksToPlaintext(blocks[tab.id] ?? []),
    )
    .filter(Boolean)
    .join("\n\n");
}

// ── Collab session ──────────────────────────────────────────────────────────

interface CollabSession {
  token: string;
  wsUrl: string;
  canWrite: boolean;
  user: { name: string; color: string };
}

function isCollabSession(value: unknown): value is CollabSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<CollabSession>;
  return (
    typeof session.token === "string" &&
    session.token.length > 0 &&
    typeof session.wsUrl === "string" &&
    session.wsUrl.length > 0 &&
    typeof session.canWrite === "boolean" &&
    !!session.user &&
    typeof session.user.name === "string" &&
    typeof session.user.color === "string"
  );
}

async function fetchCollabSession(
  docId: string,
  signal?: AbortSignal,
): Promise<CollabSession | null> {
  const res = await fetch(`/api/documents/${encodeURIComponent(docId)}/collab-token`, {
    cache: "no-store",
    signal,
  });
  if (!res.ok) return null;
  const session: unknown = await res.json();
  return isCollabSession(session) ? session : null;
}

function getJwtExpiryMs(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(padded)) as { exp?: unknown };
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

function tokenNeedsRefresh(token: string): boolean {
  const expiry = getJwtExpiryMs(token);
  return expiry === null || expiry - Date.now() <= COLLAB_TOKEN_REFRESH_SKEW_MS;
}

// ── TabEditor ───────────────────────────────────────────────────────────────

/** Minimal handle the wrapper needs to insert blocks into the active editor. */
interface DocEditorHandle {
  insertBlocks: (blocks: any[], referenceBlock: any, placement?: "before" | "after") => void;
  document: DocBlock[];
}

interface TabEditorBaseProps {
  editable: boolean;
  onBlocksChange: (blocks: DocBlock[]) => void;
  /** Reports the live editor instance up so the toolbar can insert blocks. */
  onReady?: (editor: DocEditorHandle) => void;
}

interface TabEditorSingleProps extends TabEditorBaseProps {
  mode: "single";
  seedBlocks: DocBlock[] | null;
}

interface TabEditorCollabProps extends TabEditorBaseProps {
  mode: "collab";
  seedBlocks: DocBlock[] | null;
  ydoc: Y.Doc;
  provider: HocuspocusProvider;
  fragmentName: string;
  user: { name: string; color: string };
  canWrite: boolean;
}

type TabEditorProps = TabEditorSingleProps | TabEditorCollabProps;

/**
 * Pure editing surface — no DB writes. Receives blocks and propagates changes
 * upward. In collab mode it binds to the shared Yjs XML fragment for the
 * active tab, seeding it from `seedBlocks` when it's first opened.
 */
function TabEditor(props: TabEditorProps) {
  const { resolvedTheme } = useTheme();
  const dictionary = BN_LOCALE[useI18nStore.getState().locale] ?? bnEn;

  // Collab branch
  if (props.mode === "collab") {
    return (
      <CollabTabEditor
        {...props}
        dictionary={dictionary}
        resolvedTheme={resolvedTheme}
      />
    );
  }

  // Single-user branch
  return (
    <SingleTabEditor
      {...props}
      dictionary={dictionary}
      resolvedTheme={resolvedTheme}
    />
  );
}

// Single-user TabEditor inner
function SingleTabEditor({
  seedBlocks,
  editable,
  onBlocksChange,
  onReady,
  dictionary,
  resolvedTheme,
}: TabEditorSingleProps & { dictionary: typeof bnEn; resolvedTheme: string | undefined }) {
  const { t } = useTranslation();

  const editor = useCreateBlockNote({ schema: docSchema, initialContent: seedBlocks as any, dictionary });

  React.useEffect(() => {
    onReady?.(editor as unknown as DocEditorHandle);
  }, [editor, onReady]);

  return (
    <BlockNoteView
      editor={editor}
      editable={editable}
      onChange={() => onBlocksChange(editor.document as DocBlock[])}
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      slashMenu={false}
    >
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) =>
          filterSuggestionItems(
            [...getDefaultReactSlashMenuItems(editor as any), ...customSlashItems(editor, t)],
            query,
          )
        }
      />
    </BlockNoteView>
  );
}

// Collab TabEditor inner — binds to a named Yjs XML fragment
function CollabTabEditor({
  seedBlocks,
  editable,
  onBlocksChange,
  onReady,
  ydoc,
  provider,
  fragmentName,
  user,
  dictionary,
  resolvedTheme,
}: TabEditorCollabProps & { dictionary: typeof bnEn; resolvedTheme: string | undefined }) {
  const { t } = useTranslation();
  const seeded = React.useRef(false);
  const readyRef = React.useRef(false);

  const editor = useCreateBlockNote({ schema: docSchema, dictionary, collaboration: { fragment: ydoc.getXmlFragment(fragmentName), user, provider: { awareness: provider.awareness ?? undefined } } as any });

  React.useEffect(() => {
    onReady?.(editor as unknown as DocEditorHandle);
  }, [editor, onReady]);

  // Seed the fragment from at-rest blocks when the fragment is empty, then
  // unlock autosave. Falls back after 500ms when WS is offline.
  React.useEffect(() => {
    const seedAndReady = () => {
      if (!seeded.current) {
        seeded.current = true;
        if (
          editable &&
          seedBlocks &&
          seedBlocks.length > 0 &&
          ydoc.getXmlFragment(fragmentName).length === 0
        ) {
          editor.replaceBlocks(editor.document, seedBlocks as any);
        }
      }
      readyRef.current = true;
    };

    const onSynced = () => seedAndReady();
    provider.on("synced", onSynced);

    const offlineSeed = setTimeout(() => {
      if (!readyRef.current) seedAndReady();
    }, 500);

    return () => {
      clearTimeout(offlineSeed);
      provider.off("synced", onSynced);
    };
  }, [provider, ydoc, editor, seedBlocks, editable, fragmentName]);

  return (
    <BlockNoteView
      editor={editor}
      editable={editable}
      onChange={() => {
        if (readyRef.current) onBlocksChange(editor.document as DocBlock[]);
      }}
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      slashMenu={false}
    >
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={async (query) =>
          filterSuggestionItems(
            [...getDefaultReactSlashMenuItems(editor as any), ...customSlashItems(editor, t)],
            query,
          )
        }
      />
    </BlockNoteView>
  );
}

// ── DocTabs ─────────────────────────────────────────────────────────────────

export interface DocTabsProps {
  docId: string;
  initialTitle: string;
  initialMetadata: Record<string, unknown>;
  collab: boolean;
  /** When provided, a back affordance is shown in the doc header. */
  onBack?: () => void;
}

/**
 * Wrapper that owns multi-tab state, persistence, and (optionally) real-time
 * collaboration. Picks the right inner implementation based on `collab` prop
 * and collab-token availability.
 */
export function DocTabs({ docId, initialTitle, initialMetadata, collab, onBack }: DocTabsProps) {
  const { t } = useTranslation();
  const [collabState, setCollabState] = React.useState<
    { kind: "loading" } | { kind: "fallback" } | { kind: "ready"; session: CollabSession }
  >(collab ? { kind: "loading" } : { kind: "fallback" });

  React.useEffect(() => {
    if (!collab) return;
    let cancelled = false;
    // Never get stuck on the "connecting…" screen: if the collab token doesn't
    // resolve quickly (slow/flaky network, relay down), fall back to single-user
    // editing so the editor always opens. Snapshot persistence still works.
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
      if (!cancelled) setCollabState((s) => (s.kind === "loading" ? { kind: "fallback" } : s));
    }, COLLAB_TOKEN_REQUEST_TIMEOUT_MS);
    (async () => {
      try {
        const session = await fetchCollabSession(docId, controller.signal);
        if (!cancelled) setCollabState(session ? { kind: "ready", session } : { kind: "fallback" });
      } catch {
        if (!cancelled) setCollabState({ kind: "fallback" });
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [docId, collab]);

  if (collabState.kind === "loading") {
    return (
      <div className="max-w-3xl mx-auto py-10 px-4 text-sm text-muted-foreground">
        {t("docs.connecting")}
      </div>
    );
  }

  if (collabState.kind === "ready") {
    return (
      <DocTabsCollab
        docId={docId}
        initialTitle={initialTitle}
        initialMetadata={initialMetadata}
        session={collabState.session}
        refreshSession={() => fetchCollabSession(docId)}
        onBack={onBack}
      />
    );
  }

  // Single-user fallback
  return (
    <DocTabsSingle
      docId={docId}
      initialTitle={initialTitle}
      initialMetadata={initialMetadata}
      onBack={onBack}
    />
  );
}

// ── Single-user tabs implementation ─────────────────────────────────────────

function DocTabsSingle({
  docId,
  initialTitle,
  initialMetadata,
  onBack,
}: {
  docId: string;
  initialTitle: string;
  initialMetadata: Record<string, unknown>;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const derived = React.useMemo(
    () => deriveInitialDocTabs(initialMetadata, t("tabs.defaultName")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [tabs, setTabs] = React.useState<DocTab[]>(derived.tabs);
  const [activeTabId, setActiveTabId] = React.useState(derived.tabs[0].id);
  const [title, setTitle] = React.useState(initialTitle);
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>("saved");
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");

  // In-memory blocks per tab — the source of truth between DB saves
  const blocksByTab = React.useRef<Record<string, DocBlock[]>>(derived.blocks);
  // In-memory Univer snapshots per office tab.
  const univerByTab = React.useRef<Record<string, unknown>>(derived.univer ?? {});
  // Synchronous live-snapshot getter for the active office tab (set by OfficeTab).
  const liveSheetSnapshotRef = React.useRef<(() => unknown) | null>(null);
  const dirtyRef = React.useRef(false);
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleExport = React.useCallback(
    async (format: "csv" | "xlsx") => {
      const snap = liveSheetSnapshotRef.current?.() ?? univerByTab.current[activeTabId] ?? null;
      if (!snap) return;
      const tab = tabs.find((tb) => tb.id === activeTabId);
      const base = title.trim() || tab?.name?.trim() || "spreadsheet";
      const { exportCsv, exportXlsx } = await import("@/lib/office/sheet-export");
      if (format === "csv") exportCsv(snap, base, tab?.name);
      else await exportXlsx(snap, base);
    },
    [activeTabId, tabs, title],
  );

  const persist = React.useCallback(
    async (titleValue: string, currentTabs: DocTab[], blocks: Record<string, DocBlock[]>) => {
      setSaveStatus("saving");
      const allPlaintext = aggregatePlaintext(currentTabs, blocks, univerByTab.current);
      try {
        await fetch(`/api/documents/${docId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: titleValue,
            content: allPlaintext,
            metadata: {
              docTabs: { tabs: currentTabs, blocks, univer: univerByTab.current },
              content_format: "blocknote",
            },
          }),
        });
        setSaveStatus("saved");
        dirtyRef.current = false;
      } catch {
        setSaveStatus("unsaved");
      }
    },
    [docId],
  );

  const scheduleAutosave = React.useCallback(
    (titleValue: string, currentTabs: DocTab[], blocks: Record<string, DocBlock[]>) => {
      setSaveStatus("unsaved");
      dirtyRef.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(
        () => void persist(titleValue, currentTabs, blocks),
        AUTOSAVE_DEBOUNCE_MS,
      );
    },
    [persist],
  );

  // Persist immediately (no debounce) — for structural tab changes so they can't
  // be lost by leaving the page within the autosave debounce window.
  const saveNow = React.useCallback(
    (titleValue: string, currentTabs: DocTab[], blocks: Record<string, DocBlock[]>) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      dirtyRef.current = true;
      void persist(titleValue, currentTabs, blocks);
    },
    [persist],
  );

  React.useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (dirtyRef.current && typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(`/api/documents/${docId}/process`);
      }
    };
  }, [docId]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setTitle(next);
    scheduleAutosave(next, tabs, blocksByTab.current);
  };

  const handleBlocksChange = React.useCallback(
    (blocks: DocBlock[]) => {
      blocksByTab.current = { ...blocksByTab.current, [activeTabId]: blocks };
      scheduleAutosave(title, tabs, blocksByTab.current);
    },
    [activeTabId, scheduleAutosave, tabs, title],
  );

  const handleOfficeChange = React.useCallback(
    (snapshot: unknown) => {
      univerByTab.current = { ...univerByTab.current, [activeTabId]: snapshot };
      scheduleAutosave(title, tabs, blocksByTab.current);
    },
    [activeTabId, scheduleAutosave, tabs, title],
  );

  // Turn the active tab into a full-page HTML view (or clear it back to the editor).
  const setActiveHtml = (html: string | undefined) => {
    const newTabs = tabs.map((tb) => (tb.id === activeTabId ? { ...tb, html } : tb));
    setTabs(newTabs);
    saveNow(title, newTabs, blocksByTab.current);
  };

  const handleAddTab = (kind: TabKind) => {
    const newTab: DocTab = {
      id: crypto.randomUUID(),
      name: t(kind === "blocknote" ? "tabs.newTabName" : `office.new.${kind}`),
      kind,
    };
    const newTabs = [...tabs, newTab];
    if (isOfficeKind(kind)) {
      univerByTab.current = { ...univerByTab.current, [newTab.id]: null };
    } else {
      blocksByTab.current = { ...blocksByTab.current, [newTab.id]: [] };
    }
    setTabs(newTabs);
    setActiveTabId(newTab.id);
    saveNow(title, newTabs, blocksByTab.current);
  };

  const handleDeleteTab = (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab || tabs.length <= 1) return;
    if (!window.confirm(`${tab.name}${t("tabs.deleteConfirm")}`)) return;
    const newTabs = tabs.filter((t) => t.id !== tabId);
    const newBlocks = { ...blocksByTab.current };
    delete newBlocks[tabId];
    blocksByTab.current = newBlocks;
    const newUniver = { ...univerByTab.current };
    delete newUniver[tabId];
    univerByTab.current = newUniver;
    setTabs(newTabs);
    if (activeTabId === tabId) setActiveTabId(newTabs[0].id);
    saveNow(title, newTabs, blocksByTab.current);
  };

  const startRename = (tab: DocTab) => {
    setRenamingId(tab.id);
    setRenameValue(tab.name);
  };

  const commitRename = () => {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    if (trimmed) {
      const newTabs = tabs.map((t) => (t.id === renamingId ? { ...t, name: trimmed } : t));
      setTabs(newTabs);
      saveNow(title, newTabs, blocksByTab.current);
    }
    setRenamingId(null);
  };

  return (
    <DocTabsLayout
      docId={docId}
      onBack={onBack}
      title={title}
      onTitleChange={handleTitleChange}
      tabs={tabs}
      activeTabId={activeTabId}
      onTabClick={setActiveTabId}
      onAddTab={handleAddTab}
      onDeleteTab={handleDeleteTab}
      renamingId={renamingId}
      renameValue={renameValue}
      onRenameValueChange={setRenameValue}
      onDoubleClickTab={startRename}
      onCommitRename={commitRename}
      saveStatus={saveStatus}
      canWrite={true}
      connected={null}
      peers={null}
      activeHtml={tabs.find((tb) => tb.id === activeTabId)?.html}
      onInsertHtmlFile={(html) => setActiveHtml(html)}
      onClearHtml={() => setActiveHtml(undefined)}
      fullBleed={isOfficeKind(tabs.find((tb) => tb.id === activeTabId)?.kind)}
      canExport={isOfficeKind(tabs.find((tb) => tb.id === activeTabId)?.kind)}
      onExport={handleExport}
    >
      {isOfficeKind(tabs.find((tb) => tb.id === activeTabId)?.kind) ? (
        <OfficeTab
          key={activeTabId}
          tabId={activeTabId}
          kind={tabs.find((tb) => tb.id === activeTabId)!.kind as OfficeKind}
          initialSnapshot={univerByTab.current[activeTabId] ?? null}
          editable={true}
          onSnapshotChange={handleOfficeChange}
          onRegisterSnapshotGetter={(g) => { liveSheetSnapshotRef.current = g; }}
        />
      ) : (
        <TabEditor
          key={activeTabId}
          mode="single"
          seedBlocks={blocksByTab.current[activeTabId] ?? null}
          editable={true}
          onBlocksChange={handleBlocksChange}
        />
      )}
    </DocTabsLayout>
  );
}

// ── Collab tabs implementation ───────────────────────────────────────────────

function DocTabsCollab({
  docId,
  initialTitle,
  initialMetadata,
  session,
  refreshSession,
  onBack,
}: {
  docId: string;
  initialTitle: string;
  initialMetadata: Record<string, unknown>;
  session: CollabSession;
  refreshSession: () => Promise<CollabSession | null>;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const derived = React.useMemo(
    () => deriveInitialDocTabs(initialMetadata, t("tabs.defaultName")),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [tabs, setTabs] = React.useState<DocTab[]>(derived.tabs);
  const [activeTabId, setActiveTabId] = React.useState(derived.tabs[0].id);
  const [title, setTitle] = React.useState(initialTitle);
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>("saved");
  const [connected, setConnected] = React.useState(false);
  const [peers, setPeers] = React.useState(1);
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");

  const blocksByTab = React.useRef<Record<string, DocBlock[]>>(derived.blocks);
  const univerByTab = React.useRef<Record<string, unknown>>(derived.univer ?? {});
  const liveSheetSnapshotRef = React.useRef<(() => unknown) | null>(null);
  const dirtyRef = React.useRef(false);
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabsSeeded = React.useRef(false);
  const sessionRef = React.useRef(session);
  const refreshSessionRef = React.useRef(refreshSession);
  const forceTokenRefreshRef = React.useRef(false);
  const authReconnectTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const authReconnectAttempts = React.useRef(0);

  React.useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  React.useEffect(() => {
    refreshSessionRef.current = refreshSession;
  }, [refreshSession]);

  const getTokenForConnect = React.useCallback(async () => {
    const current = sessionRef.current;
    if (!forceTokenRefreshRef.current && !tokenNeedsRefresh(current.token)) return current.token;

    try {
      const fresh = await refreshSessionRef.current();
      if (fresh?.token) {
        sessionRef.current = fresh;
        forceTokenRefreshRef.current = false;
        return fresh.token;
      }
    } catch {
      // Fall back to the last known token. If it is already invalid, the
      // auth-failure reconnect loop below will try again with a fresh token.
    }

    return current.token;
  }, []);

  // One Y.Doc + provider for the lifetime of this component. Room = docId.
  const { ydoc, provider } = React.useMemo(() => {
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: session.wsUrl,
      name: docId,
      token: getTokenForConnect,
      document: ydoc,
    });
    return { ydoc, provider };
  }, [docId, getTokenForConnect, session.wsUrl]);

  // Tabs list is collaborative: a Y.Array of plain {id,name,html?,kind?} maps
  const yTabs = React.useMemo(
    () => ydoc.getArray<{ id: string; name: string; html?: string; kind?: TabKind }>("docTabs"),
    [ydoc],
  );

  // Authoritatively replace the whole shared tab list with `next`, and mirror it
  // into local state. Full-replace (not incremental push) avoids the data-loss
  // race where a not-yet-seeded (empty) yTabs makes a single push clobber every
  // existing tab via the observer. The local list is the writer's source of truth.
  const writeTabs = React.useCallback(
    (next: DocTab[]) => {
      ydoc.transact(() => {
        yTabs.delete(0, yTabs.length);
        yTabs.push(next.map((t) => ({ id: t.id, name: t.name, html: t.html, kind: t.kind })));
      });
      setTabs(next);
    },
    [ydoc, yTabs],
  );

  // Connection indicators
  React.useEffect(() => {
    const onStatus = (e: { status: string }) => setConnected(e.status === "connected");
    provider.on("status", onStatus);

    const scheduleAuthReconnect = () => {
      if (authReconnectTimer.current) return;
      setConnected(false);
      forceTokenRefreshRef.current = true;
      authReconnectAttempts.current += 1;
      const delay = Math.min(
        COLLAB_RECONNECT_MAX_DELAY_MS,
        COLLAB_RECONNECT_BASE_DELAY_MS * 2 ** Math.min(authReconnectAttempts.current - 1, 5),
      );
      authReconnectTimer.current = setTimeout(() => {
        authReconnectTimer.current = null;
        void provider.connect();
      }, delay);
    };

    const onAuthenticated = () => {
      authReconnectAttempts.current = 0;
      if (authReconnectTimer.current) {
        clearTimeout(authReconnectTimer.current);
        authReconnectTimer.current = null;
      }
    };
    provider.on("authenticated", onAuthenticated);

    const onAuthenticationFailed = () => {
      scheduleAuthReconnect();
    };
    provider.on("authenticationFailed", onAuthenticationFailed);

    const onClose = ({ event }: { event?: { code?: number; reason?: string } }) => {
      if (event?.code === HOCUSPOCUS_UNAUTHORIZED_CLOSE_CODE) {
        scheduleAuthReconnect();
      }
    };
    provider.on("close", onClose);

    const onSynced = (event?: { state?: boolean }) => {
      if (event?.state === false) return;
      setConnected(true);
      if (!tabsSeeded.current) {
        tabsSeeded.current = true;
        if (yTabs.length > 0) {
          // Adopt the shared tabs list (peer/relay-persisted data wins).
          const adopted: DocTab[] = yTabs.toArray().map((item) => ({
            id: item.id,
            name: item.name,
            html: item.html,
            kind: item.kind,
          }));
          setTabs(adopted);
          setActiveTabId((prev) => (adopted.some((t) => t.id === prev) ? prev : adopted[0].id));
        } else if (session.canWrite) {
          // Empty shared list (fresh room) → seed it from the DB-derived tabs.
          writeTabs(derived.tabs);
        }
      }
    };
    provider.on("synced", onSynced);

    // Offline fallback: if synced never fires, still seed the shared list from
    // the DB-derived tabs so a later peer/mutation has the full set.
    const offlineSeed = setTimeout(() => {
      if (!tabsSeeded.current) {
        tabsSeeded.current = true;
        if (session.canWrite && yTabs.length === 0) writeTabs(derived.tabs);
      }
    }, 500);

    const awareness = provider.awareness;
    const onAwareness = () => setPeers(awareness ? awareness.getStates().size : 1);
    awareness?.on("change", onAwareness);
    onAwareness();

    return () => {
      clearTimeout(offlineSeed);
      if (authReconnectTimer.current) {
        clearTimeout(authReconnectTimer.current);
        authReconnectTimer.current = null;
      }
      provider.off("status", onStatus);
      provider.off("synced", onSynced);
      provider.off("authenticated", onAuthenticated);
      provider.off("authenticationFailed", onAuthenticationFailed);
      provider.off("close", onClose);
      awareness?.off("change", onAwareness);
    };
  }, [provider, ydoc, yTabs, derived.tabs, session.canWrite, writeTabs]);

  // Observe the shared tabs array — keep local state in sync with peers
  React.useEffect(() => {
    const observer = () => {
      const updated: DocTab[] = yTabs.toArray().map((item) => ({
        id: item.id,
        name: item.name,
        html: item.html,
        kind: item.kind,
      }));
      if (updated.length > 0) {
        setTabs(updated);
        // Keep active tab valid
        setActiveTabId((prev) => (updated.some((t) => t.id === prev) ? prev : updated[0].id));
      }
    };
    yTabs.observe(observer);
    return () => yTabs.unobserve(observer);
  }, [yTabs]);

  React.useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (dirtyRef.current && typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(`/api/documents/${docId}/process`);
      }
      provider.destroy();
      ydoc.destroy();
    };
  }, [provider, ydoc, docId]);

  const persist = React.useCallback(
    async (titleValue: string, currentTabs: DocTab[], blocks: Record<string, DocBlock[]>) => {
      if (!session.canWrite) return;
      setSaveStatus("saving");
      const allPlaintext = aggregatePlaintext(currentTabs, blocks, univerByTab.current);
      try {
        await fetch(`/api/documents/${docId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: titleValue,
            content: allPlaintext,
            metadata: {
              docTabs: { tabs: currentTabs, blocks, univer: univerByTab.current },
              content_format: "blocknote",
            },
          }),
        });
        setSaveStatus("saved");
        dirtyRef.current = false;
      } catch {
        setSaveStatus("unsaved");
      }
    },
    [docId, session.canWrite],
  );

  const scheduleAutosave = React.useCallback(
    (titleValue: string, currentTabs: DocTab[], blocks: Record<string, DocBlock[]>) => {
      if (!session.canWrite) return;
      setSaveStatus("unsaved");
      dirtyRef.current = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(
        () => void persist(titleValue, currentTabs, blocks),
        AUTOSAVE_DEBOUNCE_MS,
      );
    },
    [persist, session.canWrite],
  );

  // Persist immediately (no debounce) — used for structural tab changes (add /
  // delete / rename / set-HTML) so they can't be lost by leaving the page within
  // the autosave debounce window.
  const saveNow = React.useCallback(
    (titleValue: string, currentTabs: DocTab[], blocks: Record<string, DocBlock[]>) => {
      if (!session.canWrite) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      dirtyRef.current = true;
      void persist(titleValue, currentTabs, blocks);
    },
    [persist, session.canWrite],
  );

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setTitle(next);
    scheduleAutosave(next, tabs, blocksByTab.current);
  };

  const handleBlocksChange = React.useCallback(
    (blocks: DocBlock[]) => {
      blocksByTab.current = { ...blocksByTab.current, [activeTabId]: blocks };
      scheduleAutosave(title, tabs, blocksByTab.current);
    },
    [activeTabId, scheduleAutosave, tabs, title],
  );

  const handleOfficeChange = React.useCallback(
    (snapshot: unknown) => {
      univerByTab.current = { ...univerByTab.current, [activeTabId]: snapshot };
      scheduleAutosave(title, tabs, blocksByTab.current);
    },
    [activeTabId, scheduleAutosave, tabs, title],
  );

  const handleExport = React.useCallback(
    async (format: "csv" | "xlsx") => {
      const snap = liveSheetSnapshotRef.current?.() ?? univerByTab.current[activeTabId] ?? null;
      if (!snap) return;
      const tab = tabs.find((tb) => tb.id === activeTabId);
      const base = title.trim() || tab?.name?.trim() || "spreadsheet";
      const { exportCsv, exportXlsx } = await import("@/lib/office/sheet-export");
      if (format === "csv") exportCsv(snap, base, tab?.name);
      else await exportXlsx(snap, base);
    },
    [activeTabId, tabs, title],
  );

  // Turn the active tab into a full-page HTML view (or clear it). The html lives
  // on the shared Yjs tab item so peers see the change live.
  const setActiveHtml = (html: string | undefined) => {
    if (!session.canWrite) return;
    const newTabs = tabs.map((tb) => (tb.id === activeTabId ? { ...tb, html } : tb));
    writeTabs(newTabs);
    saveNow(title, newTabs, blocksByTab.current);
  };

  const handleAddTab = (kind: TabKind) => {
    if (!session.canWrite) return;
    const newTab: DocTab = {
      id: crypto.randomUUID(),
      name: t(kind === "blocknote" ? "tabs.newTabName" : `office.new.${kind}`),
      kind,
    };
    const newTabs = [...tabs, newTab];
    if (isOfficeKind(kind)) {
      univerByTab.current = { ...univerByTab.current, [newTab.id]: null };
    } else {
      blocksByTab.current = { ...blocksByTab.current, [newTab.id]: [] };
    }
    writeTabs(newTabs);
    setActiveTabId(newTab.id);
    saveNow(title, newTabs, blocksByTab.current);
  };

  const handleDeleteTab = (tabId: string) => {
    if (!session.canWrite || tabs.length <= 1) return;
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    if (!window.confirm(`${tab.name}${t("tabs.deleteConfirm")}`)) return;
    const newBlocks = { ...blocksByTab.current };
    delete newBlocks[tabId];
    blocksByTab.current = newBlocks;
    const newUniver = { ...univerByTab.current };
    delete newUniver[tabId];
    univerByTab.current = newUniver;
    const newTabs = tabs.filter((t) => t.id !== tabId);
    writeTabs(newTabs);
    if (activeTabId === tabId && newTabs.length > 0) setActiveTabId(newTabs[0].id);
    saveNow(title, newTabs, blocksByTab.current);
  };

  const startRename = (tab: DocTab) => {
    if (!session.canWrite) return;
    setRenamingId(tab.id);
    setRenameValue(tab.name);
  };

  const commitRename = () => {
    if (!renamingId || !session.canWrite) return;
    const trimmed = renameValue.trim();
    if (trimmed) {
      const newTabs = tabs.map((t) => (t.id === renamingId ? { ...t, name: trimmed } : t));
      writeTabs(newTabs);
      saveNow(title, newTabs, blocksByTab.current);
    }
    setRenamingId(null);
  };

  return (
    <DocTabsLayout
      docId={docId}
      onBack={onBack}
      title={title}
      onTitleChange={handleTitleChange}
      tabs={tabs}
      activeTabId={activeTabId}
      onTabClick={setActiveTabId}
      onAddTab={handleAddTab}
      onDeleteTab={handleDeleteTab}
      renamingId={renamingId}
      renameValue={renameValue}
      onRenameValueChange={setRenameValue}
      onDoubleClickTab={startRename}
      onCommitRename={commitRename}
      saveStatus={saveStatus}
      canWrite={session.canWrite}
      connected={connected}
      peers={peers}
      activeHtml={tabs.find((tb) => tb.id === activeTabId)?.html}
      onInsertHtmlFile={(html) => setActiveHtml(html)}
      onClearHtml={() => setActiveHtml(undefined)}
      fullBleed={isOfficeKind(tabs.find((tb) => tb.id === activeTabId)?.kind)}
      canExport={isOfficeKind(tabs.find((tb) => tb.id === activeTabId)?.kind)}
      onExport={handleExport}
    >
      {isOfficeKind(tabs.find((tb) => tb.id === activeTabId)?.kind) ? (
        <OfficeTab
          key={activeTabId}
          tabId={activeTabId}
          kind={tabs.find((tb) => tb.id === activeTabId)!.kind as OfficeKind}
          initialSnapshot={univerByTab.current[activeTabId] ?? null}
          editable={session.canWrite}
          onSnapshotChange={handleOfficeChange}
          collabDoc={ydoc}
          onRegisterSnapshotGetter={(g) => { liveSheetSnapshotRef.current = g; }}
        />
      ) : (
        <TabEditor
          key={activeTabId}
          mode="collab"
          seedBlocks={blocksByTab.current[activeTabId] ?? null}
          editable={session.canWrite}
          onBlocksChange={handleBlocksChange}
          ydoc={ydoc}
          provider={provider}
          fragmentName={`tab:${activeTabId}`}
          user={session.user}
          canWrite={session.canWrite}
        />
      )}
    </DocTabsLayout>
  );
}

// ── Shared layout ────────────────────────────────────────────────────────────

interface DocTabsLayoutProps {
  docId: string;
  onBack?: () => void;
  title: string;
  onTitleChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  tabs: DocTab[];
  activeTabId: string;
  onTabClick: (id: string) => void;
  onAddTab: (kind: TabKind) => void;
  onDeleteTab: (id: string) => void;
  renamingId: string | null;
  renameValue: string;
  onRenameValueChange: (v: string) => void;
  onDoubleClickTab: (tab: DocTab) => void;
  onCommitRename: () => void;
  saveStatus: SaveStatus;
  canWrite: boolean;
  /** null = single-user (hide collab indicators) */
  connected: boolean | null;
  peers: number | null;
  /** When set, the active tab renders this HTML full-bleed instead of the editor. */
  activeHtml?: string;
  /** Set the active tab to a full-page HTML view from a picked .html file. */
  onInsertHtmlFile?: (html: string) => void;
  /** Clear the active tab's HTML page, returning to the rich-text editor. */
  onClearHtml?: () => void;
  /** When true, the active tab is an office editor — render children full-height, no title chrome. */
  fullBleed?: boolean;
  /** When true, the active tab is a spreadsheet → show the Export (CSV / XLSX) action. */
  canExport?: boolean;
  /** Export the active spreadsheet in the chosen format. */
  onExport?: (format: "csv" | "xlsx") => void;
  children: React.ReactNode;
}

function DocTabsLayout({
  docId,
  onBack,
  title,
  onTitleChange,
  tabs,
  activeTabId,
  onTabClick,
  onAddTab,
  onDeleteTab,
  renamingId,
  renameValue,
  onRenameValueChange,
  onDoubleClickTab,
  onCommitRename,
  saveStatus,
  canWrite,
  connected,
  peers,
  activeHtml,
  onInsertHtmlFile,
  onClearHtml,
  fullBleed,
  canExport,
  onExport,
  children,
}: DocTabsLayoutProps) {
  const { t } = useTranslation();
  const htmlFileInputRef = React.useRef<HTMLInputElement>(null);
  const [exportMenuOpen, setExportMenuOpen] = React.useState(false);
  const [addMenuOpen, setAddMenuOpen] = React.useState(false);

  // New-tab kinds offered in the add menu (icon + i18n label + tab kind).
  const addKinds: { kind: TabKind; label: string; icon: React.ReactNode }[] = [
    { kind: "blocknote", label: t("office.kind.blocknote"), icon: <FileText className="size-4" /> },
    { kind: "sheet", label: t("office.kind.sheet"), icon: <FileSpreadsheet className="size-4" /> },
  ];

  const statusLabel = !canWrite
    ? t("docs.readOnly")
    : saveStatus === "saving"
      ? t("docs.saving")
      : saveStatus === "unsaved"
        ? t("docs.unsaved")
        : t("docs.saved");
  const statusActive = canWrite && saveStatus !== "saved";

  return (
    <div className="flex h-full min-h-0">
      {/* Left tab menu (vertical) */}
      <aside className="w-48 shrink-0 border-r bg-muted/20 flex flex-col overflow-y-auto">
        <div className="flex items-center justify-between gap-1 h-11 px-3 border-b shrink-0">
          <span className="text-xs font-semibold text-muted-foreground">
            {t("tabs.title")}
          </span>
          {canWrite && (
            <div className="relative">
              <button
                onClick={() => setAddMenuOpen((o) => !o)}
                title={t("tabs.addTab")}
                aria-label={t("tabs.addTab")}
                aria-haspopup="menu"
                aria-expanded={addMenuOpen}
                className="inline-flex items-center justify-center size-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Plus className="size-4" />
              </button>
              {addMenuOpen && (
                <>
                  {/* click-away backdrop */}
                  <div className="fixed inset-0 z-40" onClick={() => setAddMenuOpen(false)} />
                  <div
                    role="menu"
                    className="absolute right-0 top-7 z-50 w-44 rounded-md border bg-popover shadow-md p-1"
                  >
                    {addKinds.map((item) => (
                      <button
                        key={item.kind}
                        role="menuitem"
                        onClick={() => {
                          setAddMenuOpen(false);
                          onAddTab(item.kind);
                        }}
                        className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 text-sm rounded-md text-foreground hover:bg-muted transition-colors"
                      >
                        <span className="text-muted-foreground">{item.icon}</span>
                        {item.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <nav className="flex flex-col gap-0.5 p-2">
          {tabs.map((tab) =>
            renamingId === tab.id ? (
              <input
                key={tab.id}
                autoFocus
                value={renameValue}
                onChange={(e) => onRenameValueChange(e.target.value)}
                onBlur={onCommitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onCommitRename();
                  if (e.key === "Escape") {
                    onRenameValueChange("");
                    onCommitRename();
                  }
                }}
                className="w-full px-2.5 py-1.5 text-sm rounded-md border bg-background outline-none focus:ring-1 focus:ring-primary"
              />
            ) : (
              <button
                key={tab.id}
                onClick={() => onTabClick(tab.id)}
                onDoubleClick={() => canWrite && onDoubleClickTab(tab)}
                title={canWrite ? t("tabs.rename") : tab.name}
                className={`group relative flex items-center justify-between gap-1.5 w-full text-left pl-3 pr-2 py-1.5 text-sm rounded-md transition-colors ${
                  activeTabId === tab.id
                    ? "bg-background shadow-sm text-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/60"
                }`}
              >
                {activeTabId === tab.id && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary" />
                )}
                <span className="truncate">{tab.name}</span>
                {canWrite && tabs.length > 1 && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteTab(tab.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        onDeleteTab(tab.id);
                      }
                    }}
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive text-sm leading-none px-0.5"
                    aria-label={t("tabs.delete")}
                  >
                    ×
                  </span>
                )}
              </button>
            ),
          )}
        </nav>
      </aside>

      {/* Main column: top toolbar + scrollable title/editor */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Top toolbar: back · live · status · summary */}
        <div className="flex items-center justify-between gap-3 h-11 px-4 border-b shrink-0">
          {onBack ? (
            <button
              onClick={onBack}
              className="inline-flex items-center gap-1 -ml-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronLeft className="size-4" />
              {t("docs.backToList")}
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3 shrink-0 text-xs">
            {connected !== null && connected && (
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400" title={t("docs.live")}>
                <span className="size-1.5 rounded-full bg-current" />
                {t("docs.online").replace("{count}", String(peers ?? 1))}
              </span>
            )}
            <span className={statusActive ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}>
              {statusLabel}
            </span>
            {canWrite && onInsertHtmlFile && (
              <>
                <input
                  ref={htmlFileInputRef}
                  type="file"
                  accept=".html,.htm,text/html"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    const text = await file.text();
                    onInsertHtmlFile(text);
                  }}
                />
                <button
                  onClick={() => htmlFileInputRef.current?.click()}
                  title={t("html.insertFile")}
                  aria-label={t("html.insertFile")}
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Code2 className="size-4" />
                  <span className="hidden sm:inline">{t("html.insertFile")}</span>
                </button>
              </>
            )}
            {canExport && onExport && (
              <div className="relative">
                <button
                  onClick={() => setExportMenuOpen((o) => !o)}
                  title={t("office.export")}
                  aria-label={t("office.export")}
                  aria-haspopup="menu"
                  aria-expanded={exportMenuOpen}
                  className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Download className="size-4" />
                  <span className="hidden sm:inline">{t("office.export")}</span>
                </button>
                {exportMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setExportMenuOpen(false)} />
                    <div role="menu" className="absolute right-0 top-7 z-50 w-44 rounded-md border bg-popover shadow-md p-1">
                      <button
                        role="menuitem"
                        onClick={() => { setExportMenuOpen(false); onExport("csv"); }}
                        className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 text-sm rounded-md text-foreground hover:bg-muted transition-colors"
                      >
                        <FileText className="size-4 text-muted-foreground" />
                        {t("office.exportCsv")}
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => { setExportMenuOpen(false); onExport("xlsx"); }}
                        className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 text-sm rounded-md text-foreground hover:bg-muted transition-colors"
                      >
                        <FileSpreadsheet className="size-4 text-emerald-600" />
                        {t("office.exportXlsx")}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            <SummaryButton docId={docId} />
          </div>
        </div>

        {/* Content: full-bleed HTML page · full-bleed office editor · or title heading + editor */}
        {activeHtml ? (
          <div className="relative flex-1 min-h-0">
            <iframe
              title={t("html.blockTitle")}
              srcDoc={activeHtml}
              sandbox="allow-scripts allow-popups allow-forms allow-modals"
              referrerPolicy="no-referrer"
              className="w-full h-full border-0 bg-white"
            />
            {canWrite && onClearHtml && (
              <button
                onClick={onClearHtml}
                title={t("html.removePage")}
                aria-label={t("html.removePage")}
                className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border bg-background/90 backdrop-blur text-muted-foreground hover:text-destructive shadow-sm transition-colors"
              >
                <X className="size-3.5" />
                {t("html.removePage")}
              </button>
            )}
          </div>
        ) : fullBleed ? (
          // Office editor (Univer) needs the full content area — no title chrome / max-width.
          <div className="flex-1 min-h-0">{children}</div>
        ) : (
          <div className="flex-1 overflow-auto">
            <div className="max-w-3xl mx-auto py-8 px-6">
              <input
                type="text"
                value={title}
                onChange={onTitleChange}
                readOnly={!canWrite}
                placeholder={t("docs.untitled")}
                className="w-full text-3xl font-bold bg-transparent border-none outline-none placeholder:text-muted-foreground/60 mb-6"
              />
              {children}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
