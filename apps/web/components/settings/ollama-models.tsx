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
  MessageSquare,
  ScanText,
  Database,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n";
import { isDesktop } from "@/lib/environment";

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

type ModelRole = "chat" | "ocr" | "embedding";

interface ModelConfig {
  chat: string;
  ocr: string;
  embedding: string;
}

const ROLES: { id: ModelRole; icon: typeof MessageSquare; color: string }[] = [
  { id: "chat", icon: MessageSquare, color: "text-blue-500 bg-blue-500/10 border-blue-500/30" },
  { id: "ocr", icon: ScanText, color: "text-amber-500 bg-amber-500/10 border-amber-500/30" },
  { id: "embedding", icon: Database, color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/30" },
];

// ─── Popular models ─────────────────────────────────────────

const popularModels = [
  { name: "qwen3:1.7b", desc: "Alibaba — 1.7B, fast chat", role: "chat" as ModelRole },
  { name: "qwen3:4b", desc: "Alibaba — 4B, balanced chat", role: "chat" as ModelRole },
  { name: "qwen3-vl:2b", desc: "Alibaba — 2B, vision+OCR (32 langs)", role: "ocr" as ModelRole },
  { name: "nomic-embed-text", desc: "Nomic — 137M, embedding", role: "embedding" as ModelRole },
  { name: "all-minilm", desc: "Sentence-transformers — 23M, fast embed", role: "embedding" as ModelRole },
  { name: "llama3.2", desc: "Meta — 3B, general-purpose", role: "chat" as ModelRole },
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

export function OllamaModels({ ollamaRunning }: { ollamaRunning?: boolean } = {}) {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState<boolean | null>(null);
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
  const [config, setConfig] = useState<ModelConfig>({ chat: "", ocr: "", embedding: "" });

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/models/active");
      const data = await res.json();
      setConfig({ chat: data.chat ?? "", ocr: data.ocr ?? "", embedding: data.embedding ?? "" });
      setEnabled(data.ollamaEnabled ?? false);
    } catch {
      // ignore
    }
  }, []);

  const handleToggleEnabled = async (next: boolean) => {
    setEnabled(next);
    try {
      await fetch("/api/models/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ollamaEnabled: next }),
      });
      if (next) {
        checkHealth().then(fetchModels);
      } else {
        setOnline(null);
        setModels([]);
      }
      toast.success(next ? t("ollama.enabled") : t("ollama.disabled"));
    } catch {
      setEnabled(!next);
      toast.error(t("ollama.toggleFailed"));
    }
  };

  const handleSetRole = async (modelName: string, role: ModelRole) => {
    // Toggle off if already assigned
    const newModel = config[role] === modelName ? "" : modelName;
    try {
      const res = await fetch("/api/models/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: newModel || config[role], role }),
      });
      const data = await res.json();
      setConfig({ chat: data.chat ?? "", ocr: data.ocr ?? "", embedding: data.embedding ?? "" });
      const roleLabel = t(`ollama.role.${role}`);
      toast.success(
        t("ollama.roleSet")
          .replace("{{role}}", roleLabel)
          .replace("{{name}}", newModel || modelName)
      );
    } catch {
      toast.error(t("ollama.setActiveFailed"));
    }
  };

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
    fetchConfig();
  }, [fetchConfig]);

  // Auto-enable when environment detection says Ollama is running
  useEffect(() => {
    if (ollamaRunning && enabled !== true) {
      setEnabled(true);
      setOnline(true);
    }
  }, [ollamaRunning, enabled]);

  // Fetch health & models when enabled state is known and true
  useEffect(() => {
    if (enabled === true) {
      checkHealth().then(fetchModels);
    }
  }, [enabled, checkHealth, fetchModels]);

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
        throw new Error((err as { error?: string }).error ?? "Failed to pull model");
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
          } catch { /* ignore */ }
        }
      }

      toast.success(t("ollama.downloaded").replace("{{name}}", name));
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
    if (!confirm(t("ollama.deleteConfirm").replace("{{name}}", name))) return;
    setDeleting(name);
    try {
      const res = await fetch(
        `/api/models/${encodeURIComponent(name)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Delete failed");
      toast.success(t("ollama.deleted").replace("{{name}}", name));
      setModels((prev) => prev.filter((m) => m.name !== name));
    } catch {
      toast.error(t("ollama.deleteFailed"));
    } finally {
      setDeleting(null);
    }
  };

  const isInstalled = (name: string) =>
    models.some((m) => m.name === name || m.name.startsWith(`${name}:`));

  const getModelRoles = (name: string): ModelRole[] =>
    ROLES.map((r) => r.id).filter((role) => config[role] === name);

  const statusText = online === null
    ? t("ollama.checking")
    : online
      ? models.length === 1
        ? t("ollama.runningOne")
        : t("ollama.runningMany").replace("{{count}}", String(models.length))
      : t("ollama.offline");

  return (
    <div className="space-y-4">
      {/* Enable toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{t("ollama.enableLabel")}</span>
          <span className="text-xs text-muted-foreground">{t("ollama.enableDesc")}</span>
        </div>
        <button
          role="switch"
          aria-checked={enabled === true}
          onClick={() => handleToggleEnabled(!enabled)}
          className={cn(
            "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
            enabled ? "bg-primary" : "bg-muted"
          )}
        >
          <span
            className={cn(
              "pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform",
              enabled ? "translate-x-4" : "translate-x-0"
            )}
          />
        </button>
      </div>

      {/* Status — only when enabled */}
      {enabled && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {online === null ? (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            ) : online ? (
              <CheckCircle2 className="size-3.5 text-green-500" />
            ) : (
              <XCircle className="size-3.5 text-destructive" />
            )}
            <span className="text-xs text-muted-foreground">{statusText}</span>
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
      )}

      {/* Everything below requires Ollama to be enabled */}
      {!enabled && (
        <div className="rounded-lg border border-dashed border-muted-foreground/30 p-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t("ollama.disabledHelp")}
          </p>
        </div>
      )}

      {/* Installed models */}
      {enabled && models.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            {t("ollama.installedModels")}
          </h4>
          <div className="space-y-1.5">
            {models.map((model) => {
              const assignedRoles = getModelRoles(model.name);
              return (
                <div
                  key={model.digest}
                  className={cn(
                    "rounded-lg border px-3 py-2 transition-colors",
                    assignedRoles.length > 0
                      ? "border-primary/40 bg-primary/5"
                      : "border-border"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <HardDrive className="size-3.5 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-medium truncate">{model.name}</p>
                          {assignedRoles.map((role) => {
                            const r = ROLES.find((x) => x.id === role)!;
                            return (
                              <span
                                key={role}
                                className={cn(
                                  "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium border",
                                  r.color
                                )}
                              >
                                <r.icon className="size-2.5" />
                                {t(`ollama.role.${role}`)}
                              </span>
                            );
                          })}
                        </div>
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
                      className="size-7 text-muted-foreground hover:text-destructive shrink-0"
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

                  {/* Role assignment buttons */}
                  <div className="flex gap-1.5 mt-2">
                    {ROLES.map((role) => {
                      const isAssigned = config[role.id] === model.name;
                      return (
                        <button
                          key={role.id}
                          onClick={() => handleSetRole(model.name, role.id)}
                          className={cn(
                            "flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors",
                            isAssigned
                              ? role.color
                              : "text-muted-foreground border-border hover:border-muted-foreground/50"
                          )}
                        >
                          <role.icon className="size-3" />
                          {t(`ollama.role.${role.id}`)}
                          {isAssigned && <CheckCircle2 className="size-2.5" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Download progress */}
      {enabled && pulling && pullProgress && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Loader2 className="size-3.5 animate-spin text-primary" />
            <span className="text-sm font-medium">
              {t("ollama.downloading").replace("{{name}}", pulling)}
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
      {enabled && online && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            {t("ollama.downloadModels")}
          </h4>
          <div className="grid grid-cols-2 gap-1.5">
            {popularModels.map((pm) => {
              const installed = isInstalled(pm.name);
              const roleInfo = ROLES.find((r) => r.id === pm.role)!;
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
                    <div className="flex items-center gap-1">
                      <p className="text-xs font-medium truncate">
                        {pm.name}
                        {installed && " ✓"}
                      </p>
                      <span className={cn("px-1 rounded text-[9px] font-medium border", roleInfo.color)}>
                        {t(`ollama.role.${pm.role}`)}
                      </span>
                    </div>
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
      {enabled && online && (
        <div className="flex gap-2">
          <Input
            placeholder={t("ollama.customModelPlaceholder")}
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
            {t("ollama.pull")}
          </Button>
        </div>
      )}

      {/* Offline help / Desktop setup guide */}
      {enabled && online === false && (
        <div className="rounded-lg border border-dashed border-muted-foreground/30 p-3 space-y-3">
          {isDesktop() && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium">{t("ollama.setupGuide")}</h4>
              <ol className="text-xs text-muted-foreground leading-relaxed space-y-1 list-decimal list-inside">
                <li>{t("ollama.setupStep1")}</li>
                <li>{t("ollama.setupStep2")}</li>
                <li>{t("ollama.setupStep3")}</li>
              </ol>
              <div className="flex gap-2 pt-1">
                <a
                  href="https://ollama.com/download"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <Download className="size-3" />
                  {t("ollama.downloadOllama")}
                </a>
              </div>
            </div>
          )}
          {!isDesktop() && (
            <p className="text-xs text-muted-foreground leading-relaxed">
              {t("ollama.installHelp")}
            </p>
          )}
        </div>
      )}

      {/* Required models checklist (desktop mode) */}
      {enabled && online && isDesktop() && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
          <h4 className="text-xs font-medium">{t("ollama.requiredModels")}</h4>
          <div className="space-y-1">
            {[
              { role: "chat", model: config.chat, required: true },
              { role: "embedding", model: config.embedding, required: true },
              { role: "ocr", model: config.ocr, required: false },
            ].map(({ role, model, required }) => {
              const installed = model && isInstalled(model);
              return (
                <div key={role} className="flex items-center gap-2 text-xs">
                  {installed ? (
                    <CheckCircle2 className="size-3.5 text-green-500" />
                  ) : (
                    <XCircle className={cn("size-3.5", required ? "text-destructive" : "text-muted-foreground")} />
                  )}
                  <span className={cn(installed ? "text-foreground" : "text-muted-foreground")}>
                    {t(`ollama.role.${role}`)}: {model || t("ollama.notSet")}
                  </span>
                  {!installed && model && (
                    <button
                      onClick={() => handlePull(model)}
                      disabled={!!pulling}
                      className="text-primary hover:underline text-[11px]"
                    >
                      {t("ollama.pull")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
