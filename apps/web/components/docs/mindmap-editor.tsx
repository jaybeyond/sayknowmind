"use client";

import * as React from "react";
import { ChevronLeft, ChevronDown, Circle, Smile, Image as ImageIcon, ArrowUp, ArrowDown, History, Share2, Link2, Users } from "lucide-react";
import type { MindElixirData, MindElixirInstance, Operation, Theme } from "mind-elixir";
import { en as meEn, ko as meKo, ja as meJa, zh_CN as meZh, type LangPack } from "mind-elixir/i18n";
import "mind-elixir/style.css";
import { toast } from "sonner";
import { useTranslation, useI18nStore } from "@/lib/i18n";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { SummaryButton } from "./summary-button";
import { VersionHistoryPanel } from "./version-history-panel";
import { ShareDialog } from "@/components/dashboard/share-dialog";
import { ShareToTeamsDialog } from "@/components/dashboard/share-to-teams-dialog";

// Built-in mind-elixir context-menu language packs, keyed by our app locales.
const ME_LOCALE: Record<string, LangPack> = { en: meEn, ko: meKo, ja: meJa, zh: meZh };

const EMOJIS = ["⭐", "✅", "❤️", "🔥", "💡", "📌", "🚀", "⚠️", "🎯", "📝", "🎉", "👍", "❓", "💪", "📅", "🔑"];

interface MindmapEditorProps {
  docId: string;
  initialTitle: string;
  initialData: MindElixirData | null;
  /** Enable real-time collaboration (falls back to single-user if unavailable). */
  collab?: boolean;
  /** When provided, a back button is shown in the header (in-place mode). */
  onBack?: () => void;
}

type SaveStatus = "saved" | "saving" | "unsaved";

const AUTOSAVE_DEBOUNCE_MS = 800;

// ── Theme mapped to the project's design tokens ──────────────────────────────
// mind-elixir applies cssVar via element.style.setProperty, so `var(--token)`
// values resolve through the app's CSS cascade — matching the brand palette AND
// switching with light/dark mode automatically (no JS needed). Branch palette
// stays in the brand's blue-violet family (concrete colors for SVG strokes).
const PROJECT_THEME: Theme = {
  name: "project",
  palette: ["#4f46e5", "#6366f1", "#7c3aed", "#2563eb", "#0ea5e9", "#8b5cf6"],
  cssVar: {
    "--root-color": "var(--primary-foreground)",
    "--root-bgcolor": "var(--primary)",
    "--main-color": "var(--card-foreground)",
    "--main-bgcolor": "var(--card)",
    "--color": "var(--card-foreground)",
    "--bgcolor": "var(--muted)",
    "--selected": "var(--ring)",
    "--main-border": "1px solid var(--border)",
  },
};

const NODE_COLORS = ["#ef4444", "#f59e0b", "#10b981", "#0ea5e9", "#6366f1", "#8b5cf6", "#ec4899", "#64748b"];

function collectTopics(node: MindElixirData["nodeData"]): string[] {
  const topics: string[] = [];
  const walk = (n: typeof node) => {
    if (n.topic) topics.push(n.topic);
    if (n.children) n.children.forEach(walk);
  };
  walk(node);
  return topics;
}

interface CollabSession {
  token: string;
  wsUrl: string;
  canWrite: boolean;
  user: { name: string; color: string };
}

export function MindmapEditor({ docId, initialTitle, initialData, collab, onBack }: MindmapEditorProps) {
  const { t } = useTranslation();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mindRef = React.useRef<MindElixirInstance | null>(null);
  const [title, setTitle] = React.useState(initialTitle);
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>("saved");
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [shareMenuOpen, setShareMenuOpen] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);
  const [teamShareOpen, setTeamShareOpen] = React.useState(false);
  const [colorOpen, setColorOpen] = React.useState(false);
  const [emojiOpen, setEmojiOpen] = React.useState(false);
  const [imageOpen, setImageOpen] = React.useState(false);
  const [imageUrl, setImageUrl] = React.useState("");
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [collabState, setCollabState] = React.useState<{ connected: boolean; peers: number; canWrite: boolean } | null>(null);
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Collab plumbing (set up inside init when enabled).
  const applyingRemote = React.useRef(false);
  const pushRemote = React.useRef<((json: string) => void) | null>(null);
  const cleanupCollab = React.useRef<(() => void) | null>(null);
  const cleanupDragLine = React.useRef<(() => void) | null>(null);
  // Last map JSON we've seen (sent or received) — used to skip echoes so two
  // peers never ping-pong refreshes. lastLocalEdit defers remote apply while
  // the user is actively editing; pendingRemote holds a deferred update.
  const lastJsonRef = React.useRef("");
  const lastLocalEditRef = React.useRef(0);
  const pendingRemoteRef = React.useRef<string | null>(null);
  const titleRef = React.useRef(title);
  titleRef.current = title;
  // Set when content changed since last index; on unmount we trigger a
  // process job (summary + embedding + EdgeQuake) so RAG sees the latest.
  const dirtyRef = React.useRef(false);

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
            metadata: { mindmap: data, content_format: "mindmap" },
          }),
        });
        setSaveStatus("saved");
      } catch {
        setSaveStatus("unsaved");
      }
    },
    [docId],
  );

  // Persist the searchable projection (debounced) and, when collaborating,
  // broadcast the latest map state to peers.
  const persistAndSync = React.useCallback(
    (data: MindElixirData) => {
      if (applyingRemote.current) return; // change came from a peer; don't echo
      const json = JSON.stringify(data);
      if (json === lastJsonRef.current) return; // nothing actually changed
      lastJsonRef.current = json;
      lastLocalEditRef.current = Date.now();
      dirtyRef.current = true;
      setSaveStatus("unsaved");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void persist(titleRef.current, data), AUTOSAVE_DEBOUNCE_MS);
      pushRemote.current?.(json);
    },
    [persist],
  );

  React.useEffect(() => {
    if (!containerRef.current) return;
    let disposed = false;

    const initMind = async () => {
      const MindElixir = (await import("mind-elixir")).default;
      if (disposed || !containerRef.current) return;

      const seedData: MindElixirData = initialData ?? { nodeData: { id: "root", topic: titleRef.current } };

      // Resolve collaboration session first (if requested + configured).
      let session: CollabSession | null = null;
      if (collab && process.env.NEXT_PUBLIC_COLLAB_WS_URL) {
        try {
          const res = await fetch(`/api/documents/${docId}/collab-token`, { cache: "no-store" });
          if (res.ok) {
            const s = (await res.json()) as CollabSession;
            if (s.token && s.wsUrl) session = s;
          }
        } catch {
          /* fall back to single-user */
        }
      }
      if (disposed || !containerRef.current) return;

      const mind = new MindElixir({
        el: containerRef.current,
        direction: (seedData.direction as 0 | 1 | 2) ?? MindElixir.SIDE,
        editable: session ? session.canWrite : true,
        draggable: session ? session.canWrite : true,
        contextMenu: { locale: ME_LOCALE[useI18nStore.getState().locale] ?? meEn },
        toolBar: true,
        keypress: true,
        allowUndo: true,
      });
      mind.init(seedData);
      // Theme maps to project tokens (presentation-only, not persisted/synced).
      mind.changeTheme(PROJECT_THEME, true);
      mindRef.current = mind;
      lastJsonRef.current = JSON.stringify(mind.getData());

      mind.bus.addListener("operation", (_op: Operation) => {
        persistAndSync(mind.getData());
      });

      // mind-elixir's built-in left/right/side toolbar changes the layout but
      // emits no event, so persist/sync after a click on it.
      const ltToolbar = containerRef.current.querySelector(".mind-elixir-toolbar.lt");
      ltToolbar?.addEventListener("click", () => {
        setTimeout(() => persistAndSync(mind.getData()), 60);
      });

      // Live connecting line: while a node is dragged, draw a curve from its
      // parent to the cursor so the link visibly follows the move. Uses screen
      // rects (no manual zoom/pan math). Editors only (read-only can't drag).
      if (!session || session.canWrite) {
        const container = containerRef.current;
        const svgNS = "http://www.w3.org/2000/svg";
        const overlay = document.createElementNS(svgNS, "svg");
        overlay.setAttribute("class", "me-drag-line-overlay");
        overlay.style.cssText =
          "position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:6;overflow:visible;";
        const path = document.createElementNS(svgNS, "path");
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "#6366f1");
        path.setAttribute("stroke-width", "2.5");
        path.setAttribute("stroke-linecap", "round");
        path.setAttribute("stroke-dasharray", "5 4");
        path.style.display = "none";
        overlay.appendChild(path);
        container.appendChild(overlay);

        let downNode: MindElixirData["nodeData"] | null = null;
        let parentEl: HTMLElement | null = null;
        let active = false;
        let downX = 0;
        let downY = 0;

        const onDown = (e: PointerEvent) => {
          if (e.button !== 0) return;
          const tpc = (e.target as HTMLElement)?.closest?.("me-tpc") as
            | (HTMLElement & { nodeObj?: MindElixirData["nodeData"] })
            | null;
          const node = tpc?.nodeObj;
          if (node?.parent) {
            downNode = node;
            downX = e.clientX;
            downY = e.clientY;
            active = false;
          } else {
            downNode = null;
          }
        };
        const onMove = (e: PointerEvent) => {
          if (!downNode) return;
          if (!active) {
            if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) < 6) return;
            parentEl = downNode.parent ? mind.findEle(downNode.parent.id) : null;
            if (!parentEl) {
              downNode = null;
              return;
            }
            active = true;
            path.style.display = "";
          }
          const rect = container.getBoundingClientRect();
          const pr = parentEl!.getBoundingClientRect();
          const px = pr.left + pr.width / 2 - rect.left;
          const py = pr.top + pr.height / 2 - rect.top;
          const cx = e.clientX - rect.left;
          const cy = e.clientY - rect.top;
          const mx = (px + cx) / 2;
          path.setAttribute("d", `M ${px} ${py} C ${mx} ${py}, ${mx} ${cy}, ${cx} ${cy}`);
        };
        const end = () => {
          downNode = null;
          parentEl = null;
          active = false;
          path.style.display = "none";
        };

        container.addEventListener("pointerdown", onDown);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);

        cleanupDragLine.current = () => {
          container.removeEventListener("pointerdown", onDown);
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", end);
          window.removeEventListener("pointercancel", end);
          overlay.remove();
        };
      }

      if (session) {
        const Y = await import("yjs");
        const { HocuspocusProvider } = await import("@hocuspocus/provider");
        if (disposed) return;

        const ydoc = new Y.Doc();
        const provider = new HocuspocusProvider({ url: session.wsUrl, name: docId, token: session.token, document: ydoc });
        const ymap = ydoc.getMap("mindmap");

        // Apply a peer's state. Skips echoes (same JSON) and, while the local
        // user is mid-edit, defers the update instead of yanking the canvas —
        // the deferred state is flushed once they go idle.
        const applyRemote = () => {
          const raw = ymap.get("data");
          if (typeof raw !== "string" || raw === lastJsonRef.current) return;
          if (Date.now() - lastLocalEditRef.current < 1500) {
            pendingRemoteRef.current = raw;
            return;
          }
          pendingRemoteRef.current = null;
          try {
            const data = JSON.parse(raw) as MindElixirData;
            lastJsonRef.current = raw;
            applyingRemote.current = true;
            mind.refresh(data);
            mind.changeTheme(PROJECT_THEME, true); // keep project theme after refresh
          } catch {
            /* ignore malformed payloads */
          } finally {
            applyingRemote.current = false;
          }
        };

        provider.on("synced", () => {
          setCollabState((s) => ({ connected: true, peers: s?.peers ?? 1, canWrite: session!.canWrite }));
          if (typeof ymap.get("data") === "string") applyRemote();
          else if (session!.canWrite) ymap.set("data", lastJsonRef.current);
        });
        provider.on("status", (e: { status: string }) =>
          setCollabState((s) => ({ connected: e.status === "connected", peers: s?.peers ?? 1, canWrite: session!.canWrite })),
        );
        ymap.observe((event) => {
          if (!event.transaction.local) applyRemote();
        });
        // Flush a deferred peer update once the local user stops editing.
        const flush = setInterval(() => {
          if (pendingRemoteRef.current && Date.now() - lastLocalEditRef.current > 1500) applyRemote();
        }, 700);
        const awareness = provider.awareness;
        const onAwareness = () =>
          setCollabState((s) => ({ connected: s?.connected ?? false, peers: awareness ? awareness.getStates().size : 1, canWrite: session!.canWrite }));
        awareness?.on("change", onAwareness);

        // Writable peers push their local map JSON into the shared doc.
        pushRemote.current = session.canWrite ? (json) => ymap.set("data", json) : null;
        setCollabState({ connected: false, peers: 1, canWrite: session.canWrite });

        cleanupCollab.current = () => {
          clearInterval(flush);
          awareness?.off("change", onAwareness);
          provider.destroy();
          ydoc.destroy();
        };
      }
    };

    void initMind();

    return () => {
      disposed = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      // Index the latest content for RAG when leaving the editor.
      if (dirtyRef.current && typeof navigator !== "undefined" && navigator.sendBeacon) {
        navigator.sendBeacon(`/api/documents/${docId}/process`);
        dirtyRef.current = false;
      }
      cleanupCollab.current?.();
      cleanupCollab.current = null;
      cleanupDragLine.current?.();
      cleanupDragLine.current = null;
      pushRemote.current = null;
      if (mindRef.current) {
        mindRef.current.destroy();
        mindRef.current = null;
      }
    };
    // init once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setTitle(next);
    if (mindRef.current) persistAndSync(mindRef.current.getData());
  };

  const applyNodeColor = (color: string | null) => {
    const mind = mindRef.current;
    if (!mind || !mind.currentNode) {
      toast.error(t("mindmap.selectNodeFirst"));
      return;
    }
    mind.reshapeNode(mind.currentNode, {
      style: color ? { background: color, color: "#ffffff" } : { background: "", color: "" },
    });
    persistAndSync(mind.getData());
  };

  // Reorder the selected node among its siblings (reliable alternative to
  // edge-precise drag).
  const moveNode = (dir: "up" | "down") => {
    const mind = mindRef.current;
    if (!mind || !mind.currentNode) {
      toast.error(t("mindmap.selectNodeFirst"));
      return;
    }
    if (dir === "up") mind.moveUpNode(mind.currentNode);
    else mind.moveDownNode(mind.currentNode);
    persistAndSync(mind.getData());
  };

  // Append an emoji/icon to the selected node.
  const addEmoji = (emoji: string) => {
    const mind = mindRef.current;
    const node = mind?.currentNode;
    if (!mind || !node) {
      toast.error(t("mindmap.selectNodeFirst"));
      return;
    }
    const icons = [...(node.nodeObj.icons ?? []), emoji];
    mind.reshapeNode(node, { icons });
    persistAndSync(mind.getData());
    setEmojiOpen(false);
  };

  // Insert an image (by URL) into the selected node; dimensions are derived
  // from the loaded image, capped to a sensible width.
  const insertImage = () => {
    const mind = mindRef.current;
    const node = mind?.currentNode;
    const url = imageUrl.trim();
    if (!mind || !node) {
      toast.error(t("mindmap.selectNodeFirst"));
      return;
    }
    if (!url) return;
    const probe = new window.Image();
    probe.onload = () => {
      const natW = probe.naturalWidth || 240;
      const natH = probe.naturalHeight || natW;
      const width = Math.min(240, natW);
      const height = Math.round(natH * (width / natW));
      mind.reshapeNode(node, { image: { url, width, height } });
      persistAndSync(mind.getData());
    };
    probe.onerror = () => toast.error(t("mindmap.imageError"));
    probe.src = url;
    setImageUrl("");
    setImageOpen(false);
  };

  const removeImage = () => {
    const mind = mindRef.current;
    const node = mind?.currentNode;
    if (!mind || !node) return;
    mind.reshapeNode(node, { image: undefined });
    persistAndSync(mind.getData());
    setImageOpen(false);
  };

  // Upload an image file directly: resize on a canvas (≤240px wide) and embed
  // it as a data URL so it travels with the map (no backend / asset store).
  const handleImageFile = (file: File) => {
    const mind = mindRef.current;
    const node = mind?.currentNode;
    if (!mind || !node) {
      toast.error(t("mindmap.selectNodeFirst"));
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error(t("mindmap.imageError"));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => toast.error(t("mindmap.imageError"));
    reader.onload = () => {
      const probe = new window.Image();
      probe.onerror = () => toast.error(t("mindmap.imageError"));
      probe.onload = () => {
        const natW = probe.naturalWidth || 240;
        const natH = probe.naturalHeight || natW;
        const width = Math.min(240, natW);
        const height = Math.round(natH * (width / natW));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          toast.error(t("mindmap.imageError"));
          return;
        }
        ctx.drawImage(probe, 0, 0, width, height);
        const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
        const dataUrl = canvas.toDataURL(mime, 0.85);
        mind.reshapeNode(node, { image: { url: dataUrl, width, height } });
        persistAndSync(mind.getData());
        setImageOpen(false);
      };
      probe.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const canEdit = collabState ? collabState.canWrite : true;

  return (
    <div className="relative flex flex-col h-full">
      {/* Single header row: back · title · theme · node color · status */}
      <div className="flex items-center gap-3 px-4 py-2 border-b shrink-0">
        {/* Sidebar toggle — only inside the dashboard's SidebarProvider. */}
        <SidebarTrigger className="shrink-0 -ml-1" />
        {onBack && (
          <button
            onClick={onBack}
            title={t("docs.backToList")}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-5" />
          </button>
        )}

        <input
          type="text"
          value={title}
          onChange={handleTitleChange}
          placeholder={t("docs.untitled")}
          readOnly={!canEdit}
          className="min-w-0 flex-1 text-lg font-bold bg-transparent border-none outline-none placeholder:text-muted-foreground"
        />

        {canEdit && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={() => moveNode("up")}
              title={t("mindmap.moveUp")}
              className="p-1 rounded-md border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <ArrowUp className="size-3.5" />
            </button>
            <button
              onClick={() => moveNode("down")}
              title={t("mindmap.moveDown")}
              className="p-1 rounded-md border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <ArrowDown className="size-3.5" />
            </button>
          </div>
        )}

        {canEdit && (
          <DropdownMenu open={colorOpen} onOpenChange={setColorOpen}>
            <DropdownMenuTrigger asChild>
              <button className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <Circle className="size-3.5" />
                <span className="hidden sm:inline">{t("mindmap.nodeColor")}</span>
                <ChevronDown className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="p-2">
              <p className="text-[11px] text-muted-foreground mb-1.5 px-0.5">{t("mindmap.nodeColorHint")}</p>
              <div className="grid grid-cols-4 gap-2">
                {NODE_COLORS.map((color) => (
                  <button
                    key={color}
                    onClick={() => { applyNodeColor(color); setColorOpen(false); }}
                    className="size-7 rounded-full border border-border/50 transition-transform hover:scale-110"
                    style={{ background: color }}
                  />
                ))}
                <button
                  onClick={() => { applyNodeColor(null); setColorOpen(false); }}
                  title={t("mindmap.nodeColorClear")}
                  className="size-7 rounded-full border border-border bg-background text-muted-foreground text-xs leading-none hover:text-foreground"
                >
                  ✕
                </button>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {canEdit && (
          <DropdownMenu open={emojiOpen} onOpenChange={setEmojiOpen}>
            <DropdownMenuTrigger asChild>
              <button title={t("mindmap.emoji")} className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <Smile className="size-3.5" />
                <ChevronDown className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="p-2">
              <p className="text-[11px] text-muted-foreground mb-1.5 px-0.5">{t("mindmap.selectNodeHint")}</p>
              <div className="grid grid-cols-8 gap-1">
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => addEmoji(emoji)}
                    className="size-7 rounded hover:bg-muted text-base leading-none"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {canEdit && (
          <DropdownMenu open={imageOpen} onOpenChange={setImageOpen}>
            <DropdownMenuTrigger asChild>
              <button title={t("mindmap.image")} className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                <ImageIcon className="size-3.5" />
                <ChevronDown className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="p-2 w-64">
              <p className="text-[11px] text-muted-foreground mb-1.5 px-0.5">{t("mindmap.selectNodeHint")}</p>
              <div className="flex items-center gap-1.5">
                <input
                  type="url"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") insertImage(); }}
                  placeholder={t("mindmap.imageUrl")}
                  className="flex-1 min-w-0 h-7 px-2 text-xs rounded border bg-background outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  onClick={insertImage}
                  className="shrink-0 h-7 px-2 text-xs rounded bg-primary text-primary-foreground hover:opacity-90"
                >
                  {t("mindmap.imageInsert")}
                </button>
              </div>

              <div className="flex items-center gap-2 my-2">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[10px] text-muted-foreground">{t("mindmap.or")}</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleImageFile(f);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full h-7 px-2 text-xs rounded border hover:bg-muted transition-colors"
              >
                {t("mindmap.imageUpload")}
              </button>

              <button
                onClick={removeImage}
                className="mt-2 text-[11px] text-muted-foreground hover:text-destructive"
              >
                {t("mindmap.imageRemove")}
              </button>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <SummaryButton docId={docId} />

        <div className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
          {collabState?.connected && (
            <span title={t("docs.live")}>
              ● {t("docs.online").replace("{count}", String(collabState.peers))}
            </span>
          )}
          <span>
            {!canEdit
              ? t("docs.readOnly")
              : saveStatus === "saving"
                ? t("docs.saving")
                : saveStatus === "unsaved"
                  ? t("docs.unsaved")
                  : t("docs.saved")}
          </span>
        </div>

        {canEdit && (
          <div className="relative">
            <button
              onClick={() => setShareMenuOpen((o) => !o)}
              title={t("memory.share")}
              aria-label={t("memory.share")}
              aria-haspopup="menu"
              aria-expanded={shareMenuOpen}
              className="inline-flex items-center gap-1 shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Share2 className="size-4" />
              <span className="hidden sm:inline">{t("memory.share")}</span>
            </button>
            {shareMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShareMenuOpen(false)} />
                <div role="menu" className="absolute right-0 top-7 z-50 w-44 rounded-md border bg-popover shadow-md p-1">
                  <button
                    role="menuitem"
                    onClick={() => { setShareMenuOpen(false); setShareOpen(true); }}
                    className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 text-sm rounded-md text-foreground hover:bg-muted transition-colors"
                  >
                    <Link2 className="size-4 text-muted-foreground" />
                    {t("share.createLink")}
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => { setShareMenuOpen(false); setTeamShareOpen(true); }}
                    className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 text-sm rounded-md text-foreground hover:bg-muted transition-colors"
                  >
                    <Users className="size-4 text-muted-foreground" />
                    {t("memory.shareWithTeams") ?? "Share with teams"}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <button
          onClick={() => setHistoryOpen(true)}
          title={t("docs.history.title")}
          aria-label={t("docs.history.title")}
          className="inline-flex items-center gap-1 shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <History className="size-4" />
          <span className="hidden sm:inline">{t("docs.history.title")}</span>
        </button>
      </div>

      <div ref={containerRef} className="flex-1 w-full bg-background" />

      <VersionHistoryPanel docId={docId} open={historyOpen} onClose={() => setHistoryOpen(false)} />
      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} memory={{ id: docId }} />
      <ShareToTeamsDialog open={teamShareOpen} onOpenChange={setTeamShareOpen} memoryId={docId} memoryName={title} />
    </div>
  );
}
