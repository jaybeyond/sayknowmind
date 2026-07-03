"use client";

import { KnowledgeDashboard } from "@/components/knowledge/knowledge-dashboard";
import { useTranslation } from "@/lib/i18n";

export function KnowledgeContent() {
  const { t } = useTranslation();

  return (
    <>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h1 className="font-heading font-semibold text-lg">{t("knowledge.title")}</h1>
      </div>
      <div className="flex-1 min-h-0">
        <KnowledgeDashboard />
      </div>
    </>
  );
}
