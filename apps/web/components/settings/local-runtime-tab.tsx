"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";
import { useRuntimeStore, type EnvironmentInfo } from "@/store/runtime-store";
import { Download, Check, Loader2, AlertCircle, Play, Square, HardDrive, Trash2 } from "lucide-react";

export function LocalRuntimeTab() {
  const { t } = useTranslation();
  const {
    status, downloadProgress, downloadLabel, nodeVersion, serverPort, error, environment,
    checkRuntime, downloadRuntime, startLocalServer, stopLocalServer,
  } = useRuntimeStore();

  useEffect(() => { checkRuntime(); }, [checkRuntime]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1">{t("runtime.title")}</h3>
        <p className="text-xs text-muted-foreground mb-4">
          {t("runtime.description")}
        </p>
      </div>

      {/* Status Card */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">{t("runtime.localServer")}</span>
          </div>
          <StatusBadge status={status} t={t} />
        </div>

        {nodeVersion && (
          <div className="text-xs text-muted-foreground">
            Node.js {nodeVersion}
            {serverPort && <span> · Port {serverPort}</span>}
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 text-xs text-destructive">
            <AlertCircle className="size-3.5" />
            {error}
          </div>
        )}

        {/* Download Progress */}
        {status === "downloading" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{downloadLabel}</span>
              <span className="font-mono">{downloadProgress}%</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-300"
                style={{ width: `${downloadProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          {status === "not-installed" && (
            <Button size="sm" onClick={downloadRuntime}>
              <Download className="size-4 mr-1.5" />
              {t("runtime.downloadBtn")}
            </Button>
          )}

          {status === "ready" && (
            <>
              <Button size="sm" onClick={startLocalServer}>
                <Play className="size-4 mr-1.5" />
                {t("runtime.startBtn")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleDelete(t)}>
                <Trash2 className="size-4 mr-1.5" />
                {t("runtime.removeBtn")}
              </Button>
            </>
          )}

          {status === "running" && (
            <Button size="sm" variant="outline" onClick={stopLocalServer}>
              <Square className="size-4 mr-1.5" />
              {t("runtime.stopBtn")}
            </Button>
          )}

          {status === "error" && (
            <Button size="sm" variant="outline" onClick={checkRuntime}>
              {t("runtime.retryBtn")}
            </Button>
          )}

          {status === "checking" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t("runtime.checkingEnv")}
            </div>
          )}
        </div>
      </div>

      {/* Environment Detection */}
      {environment && (
        <div className="rounded-lg border p-4 space-y-3">
          <h4 className="text-xs font-medium">{t("runtime.envDetected")}</h4>
          <div className="grid gap-1.5">
            <EnvRow label="Node.js" info={environment.node ? `${environment.node.version} (${environment.node.source})` : null} />
            <EnvRow label="Docker" info={environment.docker?.version ?? null} />
            <EnvRow label="Ollama" info={environment.ollama ? `${environment.ollama.version}${environment.ollama.running ? " ● running" : ""}` : null} />
            <EnvRow label="Git" info={environment.git?.version ?? null} />
            <EnvRow label="Server" info={environment.serverInstalled ? "✓ installed" : null} />
          </div>
        </div>
      )}

      {/* Info */}
      <div className="rounded-lg border p-4 bg-muted/30 space-y-2">
        <h4 className="text-xs font-medium">{t("runtime.whatDownloaded")}</h4>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li>· {t("runtime.nodeRuntime")}</li>
          <li>· {t("runtime.serverFiles")}</li>
          <li>· {t("runtime.pgliteDb")}</li>
        </ul>
        <p className="text-xs text-muted-foreground pt-1">
          {t("runtime.dataStoredIn")} ~/Library/Application Support/com.sayknowmind.desktop/
        </p>
      </div>
    </div>
  );
}

function StatusBadge({ status, t }: { status: string; t: (key: string) => string }) {
  const config: Record<string, { key: string; cls: string }> = {
    checking: { key: "runtime.checking", cls: "text-muted-foreground bg-muted" },
    "not-installed": { key: "runtime.notInstalled", cls: "text-yellow-700 bg-yellow-100 dark:text-yellow-400 dark:bg-yellow-900/30" },
    downloading: { key: "runtime.downloading", cls: "text-blue-700 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30" },
    ready: { key: "runtime.ready", cls: "text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-900/30" },
    running: { key: "runtime.running", cls: "text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-900/30" },
    error: { key: "runtime.error", cls: "text-red-700 bg-red-100 dark:text-red-400 dark:bg-red-900/30" },
  };
  const c = config[status] ?? config.error;
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.cls}`}>{t(c.key)}</span>;
}

function EnvRow({ label, info }: { label: string; info: string | null }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      {info ? (
        <span className="text-foreground font-mono">{info}</span>
      ) : (
        <span className="text-muted-foreground/50">not found</span>
      )}
    </div>
  );
}

async function handleDelete(t: (key: string) => string) {
  if (!confirm(t("runtime.confirmRemove"))) return;
  try {
    await fetch("/api/desktop/runtime?action=delete", { method: "POST" });
    useRuntimeStore.getState().checkRuntime();
  } catch {
    // silent
  }
}
