"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";
import { useRuntimeStore } from "@/store/runtime-store";
import { Download, Check, Loader2, AlertCircle, Play, Square, HardDrive, Trash2 } from "lucide-react";

export function LocalRuntimeTab() {
  const { t } = useTranslation();
  const {
    status, downloadProgress, downloadLabel, nodeVersion, serverPort, error,
    checkRuntime, downloadRuntime, startLocalServer, stopLocalServer,
  } = useRuntimeStore();

  useEffect(() => { checkRuntime(); }, [checkRuntime]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-1">Local Runtime</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Run SayknowMind entirely on your device. All data stays on your machine.
        </p>
      </div>

      {/* Status Card */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HardDrive className="size-4 text-muted-foreground" />
            <span className="text-sm font-medium">Local Server</span>
          </div>
          <StatusBadge status={status} />
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
              Download Runtime (~120MB)
            </Button>
          )}

          {status === "ready" && (
            <>
              <Button size="sm" onClick={startLocalServer}>
                <Play className="size-4 mr-1.5" />
                Start Local Mode
              </Button>
              <Button size="sm" variant="outline" onClick={deleteRuntime}>
                <Trash2 className="size-4 mr-1.5" />
                Remove
              </Button>
            </>
          )}

          {status === "running" && (
            <Button size="sm" variant="outline" onClick={stopLocalServer}>
              <Square className="size-4 mr-1.5" />
              Stop Local Server
            </Button>
          )}

          {status === "error" && (
            <Button size="sm" variant="outline" onClick={checkRuntime}>
              Retry
            </Button>
          )}

          {status === "checking" && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Checking environment...
            </div>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="rounded-lg border p-4 bg-muted/30 space-y-2">
        <h4 className="text-xs font-medium">What gets downloaded?</h4>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li>· Node.js runtime (~45MB)</li>
          <li>· SayknowMind server (~75MB compressed)</li>
          <li>· PGlite embedded database (~10MB)</li>
        </ul>
        <p className="text-xs text-muted-foreground pt-1">
          Data stored in: ~/Library/Application Support/com.sayknowmind.desktop/
        </p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; class: string }> = {
    checking: { label: "Checking...", class: "text-muted-foreground bg-muted" },
    "not-installed": { label: "Not Installed", class: "text-yellow-700 bg-yellow-100 dark:text-yellow-400 dark:bg-yellow-900/30" },
    downloading: { label: "Downloading", class: "text-blue-700 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30" },
    ready: { label: "Ready", class: "text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-900/30" },
    running: { label: "Running", class: "text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-900/30" },
    error: { label: "Error", class: "text-red-700 bg-red-100 dark:text-red-400 dark:bg-red-900/30" },
  };
  const c = config[status] ?? config.error;
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.class}`}>{c.label}</span>;
}

async function deleteRuntime() {
  if (!confirm("Remove local runtime? Your data will be preserved.")) return;
  try {
    await fetch("/api/desktop/runtime/delete", { method: "POST" });
    useRuntimeStore.getState().checkRuntime();
  } catch {
    // silent
  }
}
