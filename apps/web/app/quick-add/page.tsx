"use client";

import * as React from "react";
import { Link, FileUp, FileText, Check, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = "url" | "text" | "file";

export default function QuickAddPage() {
  const [tab, setTab] = React.useState<Tab>("url");
  const [loading, setLoading] = React.useState(false);
  const [success, setSuccess] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [url, setUrl] = React.useState("");
  const [text, setText] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // Auto-fill from clipboard on mount
  React.useEffect(() => {
    navigator.clipboard.readText().then((clip) => {
      if (clip && /^https?:\/\//i.test(clip.trim())) {
        setUrl(clip.trim());
        setTab("url");
      }
    }).catch(() => {});
  }, []);

  const reset = () => {
    setUrl(""); setText(""); setTitle(""); setFile(null);
    setError(null); setSuccess(false);
  };

  const submit = async () => {
    setLoading(true); setError(null); setSuccess(false);
    try {
      let res: Response;
      if (tab === "url") {
        if (!url.trim()) { setError("URL을 입력하세요"); setLoading(false); return; }
        res = await fetch("/api/ingest/url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim() }),
        });
      } else if (tab === "text") {
        if (!text.trim()) { setError("텍스트를 입력하세요"); setLoading(false); return; }
        res = await fetch("/api/ingest/text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text.trim(), title: title.trim() || undefined }),
        });
      } else {
        if (!file) { setError("파일을 선택하세요"); setLoading(false); return; }
        const fd = new FormData();
        fd.append("file", file);
        res = await fetch("/api/ingest/file", { method: "POST", body: fd });
      }

      if (!res!.ok) {
        const data = await res!.json().catch(() => ({}));
        setError((data as { message?: string }).message || `Error ${res!.status}`);
      } else {
        setSuccess(true);
        reset();
        // Notify main window
        window.dispatchEvent(new CustomEvent("sayknow-memory-added"));
        setTimeout(() => setSuccess(false), 2000);
      }
    } catch {
      setError("네트워크 오류");
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    // Close this window via Tauri
    try {
      // @ts-expect-error Tauri API
      window.__TAURI__?.window?.getCurrent()?.close();
    } catch {
      window.close();
    }
  };

  return (
    <div className="h-screen bg-[#1a1a1a] text-white flex flex-col select-none" data-tauri-drag-region>
      {/* Title bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10" data-tauri-drag-region>
        <span className="text-xs font-medium text-white/70">메모리 추가</span>
        <button onClick={close} className="text-white/40 hover:text-white">
          <X className="size-3.5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-2 border-b border-white/10">
        {([
          { id: "url" as Tab, label: "URL", icon: Link },
          { id: "text" as Tab, label: "텍스트", icon: FileText },
          { id: "file" as Tab, label: "파일", icon: FileUp },
        ]).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => { setTab(id); setError(null); }}
            className={cn(
              "flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-xs font-medium transition-colors",
              tab === id ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80"
            )}
          >
            <Icon className="size-3" />
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 p-3 space-y-2 overflow-auto">
        {tab === "url" && (
          <input
            type="url"
            placeholder="https://..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30"
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        )}

        {tab === "text" && (
          <>
            <input
              placeholder="제목 (선택)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-1.5 rounded-lg bg-white/10 border border-white/10 text-xs text-white placeholder:text-white/30 outline-none focus:border-white/30"
            />
            <textarea
              placeholder="텍스트 내용..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              autoFocus
              className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30 resize-none"
            />
          </>
        )}

        {tab === "file" && (
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
            className="flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-white/15 hover:border-white/30 p-6 cursor-pointer transition-colors"
          >
            <FileUp className="size-6 text-white/30" />
            {file ? (
              <p className="text-xs text-white/80">{file.name}</p>
            ) : (
              <p className="text-xs text-white/40">클릭 또는 드래그</p>
            )}
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => { if (e.target.files?.[0]) setFile(e.target.files[0]); }} />
          </div>
        )}

        {error && <p className="text-xs text-red-400">{error}</p>}
        {success && (
          <div className="flex items-center gap-1 text-xs text-green-400">
            <Check className="size-3" /> 추가됨
          </div>
        )}
      </div>

      {/* Submit */}
      <div className="p-2 border-t border-white/10">
        <button
          onClick={submit}
          disabled={loading}
          className="w-full py-2 rounded-lg bg-white/15 hover:bg-white/25 text-sm font-medium text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : null}
          {loading ? "저장 중..." : "추가"}
        </button>
      </div>
    </div>
  );
}
