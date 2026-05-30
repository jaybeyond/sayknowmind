"use client";

import * as React from "react";
import { Sparkles, ChevronDown, RefreshCw } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { useTranslation } from "@/lib/i18n";
import { toast } from "sonner";

/**
 * Shows a document/mind-map's AI summary in a dropdown, and (re)generates it on
 * demand. Generation queues the standard ingestion job (summary + embedding +
 * EdgeQuake sync), then polls the document until the summary lands.
 */
export function SummaryButton({ docId }: { docId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [summary, setSummary] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);

  const fetchSummary = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/documents/${docId}`, { cache: "no-store" });
      if (r.ok) {
        const d = (await r.json()) as { summary?: string };
        setSummary(typeof d.summary === "string" && d.summary.trim() ? d.summary : null);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [docId]);

  React.useEffect(() => {
    if (open) void fetchSummary();
  }, [open, fetchSummary]);

  const generate = React.useCallback(async () => {
    setGenerating(true);
    try {
      const r = await fetch(`/api/documents/${docId}/process`, { method: "POST" });
      if (!r.ok) {
        toast.error(t("docs.summaryFailed"));
        return;
      }
      // Poll the document for the freshly-generated summary.
      for (let i = 0; i < 20; i++) {
        await new Promise((res) => setTimeout(res, 1500));
        const dr = await fetch(`/api/documents/${docId}`, { cache: "no-store" });
        if (dr.ok) {
          const d = (await dr.json()) as { summary?: string };
          if (typeof d.summary === "string" && d.summary.trim()) {
            setSummary(d.summary);
            return;
          }
        }
      }
      toast.message(t("docs.summaryGenerating"));
    } catch {
      toast.error(t("docs.summaryFailed"));
    } finally {
      setGenerating(false);
    }
  }, [docId, t]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          title={t("docs.summary")}
          className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <Sparkles className="size-3.5" />
          <span className="hidden sm:inline">{t("docs.summary")}</span>
          <ChevronDown className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-3">
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-xs font-semibold">{t("docs.summary")}</span>
          <button
            onClick={generate}
            disabled={generating}
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-50"
          >
            <RefreshCw className={`size-3 ${generating ? "animate-spin" : ""}`} />
            {summary ? t("docs.summaryRegenerate") : t("docs.summaryGenerate")}
          </button>
        </div>
        <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
          {loading
            ? t("docs.connecting")
            : generating
              ? t("docs.summaryGenerating")
              : summary ?? t("docs.summaryEmpty")}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
