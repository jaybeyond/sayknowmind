"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { RotateCcw, Save } from "lucide-react";

interface Prompts {
  summary: string;
  whatItSolves: string;
  keyPoints: string;
  tags: string;
}

const FIELD_LABELS: Record<keyof Prompts, { label: string; hint: string }> = {
  summary: {
    label: "Summary",
    hint: "How should the AI summarize? e.g. '2-3 sentence summary'",
  },
  whatItSolves: {
    label: "What it solves",
    hint: "e.g. '1-2 sentences describing what problem this content addresses'",
  },
  keyPoints: {
    label: "Key points",
    hint: "e.g. 'array of 3-7 key bullet points'",
  },
  tags: {
    label: "Tags",
    hint: "e.g. 'array of 3-10 lowercase tags/keywords'",
  },
};

export function PromptEditor() {
  const [prompts, setPrompts] = useState<Prompts | null>(null);
  const [defaults, setDefaults] = useState<Prompts | null>(null);
  const [saving, setSaving] = useState(false);

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
        toast.success("Prompts saved");
      } else {
        toast.error("Failed to save");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (defaults) {
      setPrompts({ ...defaults });
      toast("Reset to defaults — click Save to apply");
    }
  };

  if (!prompts) {
    return (
      <div className="text-sm text-muted-foreground py-4">
        Loading prompt settings...
      </div>
    );
  }

  const fields = Object.keys(FIELD_LABELS) as (keyof Prompts)[];

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Customize how the AI summarizes your saved content. These instructions are inserted into the AI prompt.
        The output language follows your browser locale automatically.
      </p>

      {fields.map((key) => (
        <div key={key} className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            {FIELD_LABELS[key].label}
          </label>
          <textarea
            value={prompts[key]}
            onChange={(e) =>
              setPrompts((prev) => prev && { ...prev, [key]: e.target.value })
            }
            placeholder={FIELD_LABELS[key].hint}
            rows={2}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
          />
        </div>
      ))}

      <div className="flex gap-2">
        <Button onClick={handleSave} disabled={saving} size="sm">
          <Save className="size-3.5 mr-1.5" />
          {saving ? "Saving..." : "Save prompts"}
        </Button>
        <Button onClick={handleReset} variant="outline" size="sm">
          <RotateCcw className="size-3.5 mr-1.5" />
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}
