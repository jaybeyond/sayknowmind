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
  const [file, setFile] = React.useState<File | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    navigator.clipboard.readText().then((clip) => {
      if (clip && /^https?:\/\//i.test(clip.trim())) {
        setUrl(clip.trim());
        setTab("url");
      }
    }).catch(() => {});
  }, []);

  const submit = async () => {
    setLoading(true); setError(null); setSuccess(false);
    try {
      let res: Response;
      if (tab === "url") {
        if (!url.trim()) { setError("URL"); setLoading(false); return; }
        res = await fetch("/api/ingest/url", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim() }),
        });
      } else if (tab === "text") {
        if (!text.trim()) { setError("Text"); setLoading(false); return; }
        res = await fetch("/api/ingest/text", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text.trim() }),
        });
      } else {
        if (!file) { setError("File"); setLoading(false); return; }
        const fd = new FormData(); fd.append("file", file);
        res = await fetch("/api/ingest/file", { method: "POST", body: fd });
      }
      if (!res!.ok) { setError("Failed"); }
      else { setSuccess(true); setUrl(""); setText(""); setFile(null); setTimeout(() => setSuccess(false), 2000); }
    } catch { setError("Error"); }
    finally { setLoading(false); }
  };

  const close = () => { try { window.close(); } catch {} };

  const tabs: { id: Tab; icon: typeof Link }[] = [
    { id: "url", icon: Link },
    { id: "text", icon: FileText },
    { id: "file", icon: FileUp },
  ];

  return (
    <div className="h-screen bg-[#1a1a1a] text-white flex flex-col overflow-hidden rounded-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-3 h-8 border-b border-white/10" data-tauri-drag-region>
        <div className="flex gap-0.5">
          {tabs.map(({ id, icon: Icon }) => (
            <button
              key={id}
              onClick={() => { setTab(id); setError(null); }}
              className={cn(
                "p-1.5 rounded transition-colors",
                tab === id ? "bg-white/15 text-white" : "text-white/40 hover:text-white/70"
              )}
            >
              <Icon className="size-3.5" />
            </button>
          ))}
        </div>
        <button onClick={close} className="text-white/30 hover:text-white p-1">
          <X className="size-3" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 p-3">
        {tab === "url" && (
          <input
            type="url" placeholder="https://..." value={url}
            onChange={(e) => setUrl(e.target.value)} autoFocus
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="w-full px-3 py-2 rounded-lg bg-white/8 border border-white/10 text-sm text-white placeholder:text-white/25 outline-none focus:border-white/25"
          />
        )}
        {tab === "text" && (
          <textarea
            placeholder="..." value={text}
            onChange={(e) => setText(e.target.value)} rows={6} autoFocus
            className="w-full px-3 py-2 rounded-lg bg-white/8 border border-white/10 text-sm text-white placeholder:text-white/25 outline-none focus:border-white/25 resize-none"
          />
        )}
        {tab === "file" && (
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); }}
            className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/15 hover:border-white/30 p-8 cursor-pointer"
          >
            <FileUp className="size-5 text-white/25" />
            <p className="text-xs text-white/40">{file ? file.name : "Drop"}</p>
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => { if (e.target.files?.[0]) setFile(e.target.files[0]); }} />
          </div>
        )}

        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
        {success && <p className="text-xs text-green-400 mt-2 flex items-center gap-1"><Check className="size-3" />Done</p>}
      </div>

      {/* Submit */}
      <div className="px-3 pb-3">
        <button
          onClick={submit} disabled={loading}
          className="w-full py-2 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-medium text-white/80 transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
        >
          {loading && <Loader2 className="size-3 animate-spin" />}
          {success ? <Check className="size-3" /> : "+"}
        </button>
      </div>
    </div>
  );
}
