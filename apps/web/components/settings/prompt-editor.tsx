"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { RotateCcw, Save } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

interface Prompts {
  summary: string;
  whatItSolves: string;
  keyPoints: string;
  tags: string;
}

export function PromptEditor() {
  const { t } = useTranslation();
  const [prompts, setPrompts] = useState<Prompts | null>(null);
  const [defaults, setDefaults] = useState<Prompts | null>(null);
  const [saving, setSaving] = useState(false);

  const fieldMeta: Record<keyof Prompts, { label: string; hint: string }> = {
    summary: {
      label: t("prompts.fieldSummaryLabel"),
      hint: t("prompts.fieldSummaryHint"),
    },
    whatItSolves: {
      label: t("prompts.fieldWhatItSolvesLabel"),
      hint: t("prompts.fieldWhatItSolvesHint"),
    },
    keyPoints: {
      label: t("prompts.fieldKeyPointsLabel"),
      hint: t("prompts.fieldKeyPointsHint"),
    },
    tags: {
      label: t("prompts.fieldTagsLabel"),
      hint: t("prompts.fieldTagsHint"),
    },
  };

  useEffect(() => {
    fetch("/api/settings/prompts")
      .then((r) => r.json())
      .then((data) => {
        setPrompts(data.prompts);
        setDefaults(data.defaults);
      })
      .catch(() => {});
  }, []);

  const handleSave = async () => {
    if (!prompts) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prompts),
      });
      if (res.ok) {
        toast.success(t("prompts.saved"));
      } else {
        toast.error(t("prompts.saveFailed"));
      }
    } catch {
      toast.error(t("prompts.networkError"));
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (defaults) {
      setPrompts({ ...defaults });
      toast(t("prompts.resetNotice"));
    }
  };

  if (!prompts) {
    return (
      <div className="text-sm text-muted-foreground py-4">
        {t("prompts.loading")}
      </div>
    );
  }

  const fields = Object.keys(fieldMeta) as (keyof Prompts)[];

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {t("prompts.description")}
      </p>

      {fields.map((key) => (
        <div key={key} className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {fieldMeta[key].label}
          </label>
          <textarea
            value={prompts[key]}
            onChange={(e) =>
              setPrompts((prev) => prev && { ...prev, [key]: e.target.value })
            }
            placeholder={fieldMeta[key].hint}
            rows={2}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
          />
        </div>
      ))}

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving} size="sm">
          <Save className="size-3.5 mr-1.5" />
          {saving ? t("prompts.saving") : t("prompts.save")}
        </Button>
        <Button onClick={handleReset} variant="outline" size="sm">
          <RotateCcw className="size-3.5 mr-1.5" />
          {t("prompts.reset")}
        </Button>
      </div>
    </div>
  );
}
