"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Download,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  HardDrive,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────

interface InstalledModel {
  name: string;
  size: number;
  digest: string;
  modified_at: string;
  details?: {
    format: string;
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
}

// ─── Popular models ─────────────────────────────────────────

const popularModels = [
  { name: "llama3.2", desc: "Meta — 3B, fast general-purpose" },
  { name: "qwen2.5", desc: "Alibaba — 7B, multilingual" },
  { name: "mistral", desc: "Mistral AI — 7B, balanced" },
  { name: "gemma2", desc: "Google — 9B, efficient" },
  { name: "deepseek-r1", desc: "DeepSeek — reasoning" },
  { name: "phi4", desc: "Microsoft — 14B, compact" },
];

// ─── Format helpers ─────────────────────────────────────────

function formatSize(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Component ──────────────────────────────────────────────

export function OllamaModels() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [models, setModels] = useState<InstalledModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [customModel, setCustomModel] = useState("");
  const [pulling, setPulling] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<{
    status: string;
    pct: number;
  } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/models/health");
      const data = await res.json();
      setOnline(data.online);
    } catch {
      setOnline(false);
    }
  }, []);

  const fetchModels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/models");
      const data = await res.json();
      setModels(data.models ?? []);
    } catch {
      setModels([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkHealth().then(fetchModels);
  }, [checkHealth, fetchModels]);

  const handlePull = async (name: string) => {
    if (pulling) return;
    setPulling(name);
    setPullProgress({ status: "Starting download...", pct: 0 });

    try {
      const res = await fetch("/api/models/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { error?: string }).error ?? "Failed to pull model"
        );
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;

          try {
            const evt = JSON.parse(payload);
            const status = evt.status ?? "";
            let pct = 0;
            if (evt.total && evt.completed) {
              pct = Math.round((evt.completed / evt.total) * 100);
            }
            setPullProgress({ status, pct });
          } catch {
            // ignore parse errors
          }
        }
      }

      toast.success(`${name} downloaded`);
      await fetchModels();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Download failed"
      );
    } finally {
      setPulling(null);
      setPullProgress(null);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete ${name}?`)) return;
    setDeleting(name);
    try {
      const res = await fetch(
        `/api/models/${encodeURIComponent(name)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Delete failed");
      toast.success(`${name} deleted`);
      setModels((prev) => prev.filter((m) => m.name !== name));
    } catch {
      toast.error("Failed to delete model");
    } finally {
      setDeleting(null);
    }
  };

  const isInstalled = (name: string) =>
    models.some((m) => m.name === name || m.name.startsWith(`${name}:`));

  return (
    <div className="space-y-4">
      {/* Status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {online === null ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : online ? (
            <CheckCircle2 className="size-3.5 text-green-500" />
          ) : (
            <XCircle className="size-3.5 text-destructive" />
          )}
          <span className="text-xs text-muted-foreground">
            {online === null
              ? "Checking Ollama..."
              : online
                ? `Ollama running — ${models.length} model${models.length !== 1 ? "s" : ""} installed`
                : "Ollama offline — start it to manage models"}
          </span>
        </div>
        <button
          onClick={() => {
            checkHealth().then(fetchModels);
          }}
          className="text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      {/* Installed models */}
      {models.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            Installed Models
          </h4>
          <div className="space-y-1.5">
            {models.map((model) => (
              <div
                key={model.digest}
                className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <HardDrive className="size-3.5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {model.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {formatSize(model.size)}
                      {model.details?.parameter_size &&
                        ` · ${model.details.parameter_size}`}
                      {` · ${formatDate(model.modified_at)}`}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(model.name)}
                  disabled={deleting === model.name}
                >
                  {deleting === model.name ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="size-3.5" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Download progress */}
      {pulling && pullProgress && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin text-primary" />
            <span className="text-sm font-medium">
              Downloading {pulling}...
            </span>
          </div>
          <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
            <div
              className="bg-primary h-full rounded-full transition-all duration-300"
              style={{ width: `${pullProgress.pct}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {pullProgress.status}
            {pullProgress.pct > 0 && ` — ${pullProgress.pct}%`}
          </p>
        </div>
      )}

      {/* Popular models */}
      {online && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            Download Models
          </h4>
          <div className="grid grid-cols-2 gap-1.5">
            {popularModels.map((pm) => {
              const installed = isInstalled(pm.name);
              return (
                <button
                  key={pm.name}
                  onClick={() => !installed && handlePull(pm.name)}
                  disabled={!!pulling || installed}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                    installed
                      ? "border-primary/30 bg-primary/5 opacity-60 cursor-default"
                      : "border-border hover:border-primary/50 hover:bg-primary/5"
                  )}
                >
                  <Download
                    className={cn(
                      "size-3.5 shrink-0",
                      installed
                        ? "text-primary"
                        : "text-muted-foreground"
                    )}
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">
                      {pm.name}
                      {installed && " ✓"}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {pm.desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Custom model input */}
      {online && (
        <div className="flex gap-2">
          <Input
            placeholder="Custom model name (e.g. codellama:13b)"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            className="text-sm h-9"
            onKeyDown={(e) => {
              if (e.key === "Enter" && customModel.trim()) {
                handlePull(customModel.trim());
                setCustomModel("");
              }
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-9 shrink-0"
            disabled={!customModel.trim() || !!pulling}
            onClick={() => {
              if (customModel.trim()) {
                handlePull(customModel.trim());
                setCustomModel("");
              }
            }}
          >
            <Download className="size-3.5 mr-1" />
            Pull
          </Button>
        </div>
      )}

      {/* Offline help */}
      {online === false && (
        <div className="rounded-lg border border-dashed border-muted-foreground/30 p-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Install Ollama from{" "}
            <a
              href="https://ollama.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              ollama.com
            </a>{" "}
            and run{" "}
            <code className="text-[11px] bg-muted px-1 py-0.5 rounded">
              ollama serve
            </code>{" "}
            to get started.
          </p>
        </div>
      )}
    </div>
  );
}
