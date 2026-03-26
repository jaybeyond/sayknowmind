"use client";

import { Cpu } from "lucide-react";
import { OllamaModels } from "./ollama-models";
import { useTranslation } from "@/lib/i18n";

export function ModelsTab() {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Cpu className="size-4 text-muted-foreground" />
        <div>
          <h3 className="text-sm font-medium">{t("ai.localModels")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("ai.localModelsDesc")}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border p-4">
        <OllamaModels />
      </div>
    </div>
  );
}
