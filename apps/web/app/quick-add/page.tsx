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
        if (!url.trim()) return;
        res = await fetch("/api/ingest/url", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: url.trim() }),
        });
      } else if (tab === "text") {
        if (!text.trim()) return;
        res = await fetch("/api/ingest/text", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text.trim() }),
        });
      } else {
        if (!file) return;
        const fd = new FormData(); fd.append("file", file);
        res = await fetch("/api/ingest/file", { method: "POST", body: fd });
      }
      if (!res!.ok) setError("!");
      else { setSuccess(true); setUrl(""); setText(""); setFile(null); setTimeout(() => setSuccess(false), 2000); }
    } catch { setError("!"); }
    finally { setLoading(false); }
  };

  const close = () => { try { window.close(); } catch {} };

  const tabs: { id: Tab; icon: typeof Link }[] = [
    { id: "url", icon: Link },
    { id: "text", icon: FileText },
    { id: "file", icon: FileUp },
  ];

  return (
    <div className="h-screen flex flex-col overflow-hidden rounded-2xl"
      style={{ background: "rgba(30,30,30,0.65)", backdropFilter: "blur(40px) saturate(1.8)", WebkitBackdropFilter: "blur(40px) saturate(1.8)" }}>

      {/* Drag region + close */}
      <div className="flex items-center justify-end px-2 h-7" data-tauri-drag-region>
        <button onClick={close} className="text-white/20 hover:text-white/60 transition-colors p-0.5 rounded-full hover:bg-white/10">
          <X className="size-3" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex justify-center gap-1 px-3 pb-2">
        {tabs.map(({ id, icon: Icon }) => (
          <button
            key={id}
            onClick={() => { setTab(id); setError(null); }}
            className={cn(
              "p-2 rounded-full transition-all",
              tab === id
                ? "bg-white/15 text-white shadow-[0_0_12px_rgba(255,255,255,0.1)]"
                : "text-white/25 hover:text-white/50 hover:bg-white/5"
            )}
          >
            <Icon className="size-4" />
          </button>
        ))}
      </div>

      {/* Input */}
      <div className="flex-1 px-3 pb-2">
        {tab === "url" && (
          <input
            type="url" placeholder="https://..." value={url}
            onChange={(e) => setUrl(e.target.value)} autoFocus
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder:text-white/20 outline-none"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
          />
        )}
        {tab === "text" && (
          <textarea
            placeholder="..." value={text}
            onChange={(e) => setText(e.target.value)} rows={5} autoFocus
            className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder:text-white/20 outline-none resize-none"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
          />
        )}
        {tab === "file" && (
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); }}
            className="flex flex-col items-center justify-center gap-1 rounded-xl p-8 cursor-pointer transition-colors"
            style={{ border: "1px dashed rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.03)" }}
          >
            <FileUp className="size-5 text-white/20" />
            <p className="text-[11px] text-white/30">{file ? file.name : "drop"}</p>
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => { if (e.target.files?.[0]) setFile(e.target.files[0]); }} />
          </div>
        )}
      </div>

      {/* Status + Submit */}
      <div className="px-3 pb-3 flex items-center gap-2">
        {error && <span className="text-[10px] text-red-400/70">failed</span>}
        {success && <span className="text-[10px] text-green-400/70 flex items-center gap-0.5"><Check className="size-2.5" />saved</span>}
        <div className="flex-1" />
        <button
          onClick={submit} disabled={loading}
          className="px-4 py-1.5 rounded-full text-[11px] font-medium text-white/70 hover:text-white transition-all disabled:opacity-40"
          style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          {loading ? <Loader2 className="size-3 animate-spin" /> : "+"}
        </button>
      </div>
    </div>
  );
}
