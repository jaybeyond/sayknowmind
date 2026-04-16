"use client";

import { useEffect } from "react";
import { useTranslation } from "@/lib/i18n";
import { useRuntimeStore, type EnvironmentInfo } from "@/store/runtime-store";
import { Cpu, Loader2 } from "lucide-react";
import { OllamaModels } from "./ollama-models";

export function LocalRuntimeTab() {
  const { t } = useTranslation();
  const { status, environment, checkRuntime } = useRuntimeStore();

  useEffect(() => { checkRuntime(); }, [checkRuntime]);

  return (
    <div className="space-y-6">
      {/* Environment Detection */}
      {status === "checking" && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t("runtime.checkingEnv")}
        </div>
      )}

      {environment && (
        <div className="rounded-lg border p-4 space-y-3">
          <h4 className="text-xs font-medium">{t("runtime.envDetected")}</h4>
          <div className="grid gap-1.5">
            <EnvRow label="Ollama" info={environment.ollama ? `${environment.ollama.version}${environment.ollama.running ? " ● running" : ""}` : null} />
            <EnvRow label="Node.js" info={environment.node ? `${environment.node.version}` : null} />
            <EnvRow label="Git" info={environment.git?.version ?? null} />
          </div>
        </div>
      )}

      {/* Local Models (Ollama) */}
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Cpu className="size-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-medium">{t("ai.localModels")}</h3>
            <p className="text-xs text-muted-foreground">{t("ai.localModelsDesc")}</p>
          </div>
        </div>
        <OllamaModels ollamaRunning={environment?.ollama?.running ?? false} />
      </div>
    </div>
  );
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
