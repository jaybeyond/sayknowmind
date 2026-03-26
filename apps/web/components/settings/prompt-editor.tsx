"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { RotateCcw, Save, Loader2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

type Lang = "en" | "ko" | "zh" | "ja";
type LangPrompts = Record<Lang, string>;
type AllPrompts = Record<string, LangPrompts>;

const LANGS: { id: Lang; label: string }[] = [
  { id: "en", label: "English" },
  { id: "ko", label: "한국어" },
  { id: "zh", label: "中文" },
  { id: "ja", label: "日本語" },
];

type PromptCategory = "chat" | "ingest";

interface FieldMeta {
  key: string;
  labelKey: string;
  hintKey: string;
  category: PromptCategory;
  rows: number;
}

const FIELDS: FieldMeta[] = [
  // Chat prompts
  { key: "chatSystem", labelKey: "prompts.chatSystem", hintKey: "prompts.chatSystemHint", category: "chat", rows: 6 },
  { key: "chatRecommend", labelKey: "prompts.chatRecommend", hintKey: "prompts.chatRecommendHint", category: "chat", rows: 2 },
  { key: "chatSearch", labelKey: "prompts.chatSearch", hintKey: "prompts.chatSearchHint", category: "chat", rows: 2 },
  { key: "chatExplain", labelKey: "prompts.chatExplain", hintKey: "prompts.chatExplainHint", category: "chat", rows: 2 },
  { key: "chatCatalogFilter", labelKey: "prompts.chatCatalogFilter", hintKey: "prompts.chatCatalogFilterHint", category: "chat", rows: 3 },
  { key: "chatNoDocuments", labelKey: "prompts.chatNoDocuments", hintKey: "prompts.chatNoDocumentsHint", category: "chat", rows: 1 },
  // Document processing prompts
  { key: "summary", labelKey: "prompts.fieldSummaryLabel", hintKey: "prompts.fieldSummaryHint", category: "ingest", rows: 1 },
  { key: "whatItSolves", labelKey: "prompts.fieldWhatItSolvesLabel", hintKey: "prompts.fieldWhatItSolvesHint", category: "ingest", rows: 1 },
  { key: "keyPoints", labelKey: "prompts.fieldKeyPointsLabel", hintKey: "prompts.fieldKeyPointsHint", category: "ingest", rows: 1 },
  { key: "tags", labelKey: "prompts.fieldTagsLabel", hintKey: "prompts.fieldTagsHint", category: "ingest", rows: 1 },
  { key: "entityExtraction", labelKey: "prompts.entityExtraction", hintKey: "prompts.entityExtractionHint", category: "ingest", rows: 3 },
  { key: "categorySuggestion", labelKey: "prompts.categorySuggestion", hintKey: "prompts.categorySuggestionHint", category: "ingest", rows: 4 },
];

export function PromptEditor() {
  const { t } = useTranslation();
  const [prompts, setPrompts] = useState<AllPrompts | null>(null);
  const [defaults, setDefaults] = useState<AllPrompts | null>(null);
  const [saving, setSaving] = useState(false);
  const [activeLang, setActiveLang] = useState<Lang>("en");
  const [activeCategory, setActiveCategory] = useState<PromptCategory>("chat");

  useEffect(() => {
    fetch("/api/settings/prompts")
      .then((r) => r.json())
      .then((data) => {
        setPrompts(data.prompts);
        setDefaults(data.defaults);
      })
      .catch(() => {});
  }, []);

  // Auto-detect user language for default tab
  useEffect(() => {
    const browserLang = navigator.language.slice(0, 2) as Lang;
    if (["en", "ko", "zh", "ja"].includes(browserLang)) {
      setActiveLang(browserLang);
    }
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
      setPrompts(JSON.parse(JSON.stringify(defaults)));
      toast(t("prompts.resetNotice"));
    }
  };

  const handleResetField = (key: string) => {
    if (!defaults || !prompts) return;
    setPrompts({
      ...prompts,
      [key]: { ...prompts[key], [activeLang]: defaults[key]?.[activeLang] ?? "" },
    });
  };

  if (!prompts) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
        <Loader2 className="size-4 animate-spin" />
        {t("prompts.loading")}
      </div>
    );
  }

  const categories: { id: PromptCategory; label: string }[] = [
    { id: "chat", label: t("prompts.categoryChat") },
    { id: "ingest", label: t("prompts.categoryIngest") },
  ];

  const filteredFields = FIELDS.filter((f) => f.category === activeCategory);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {t("prompts.descriptionFull")}
      </p>

      {/* Language tabs */}
      <div className="flex gap-1 p-1 rounded-lg bg-muted/50 w-fit">
        {LANGS.map((lang) => (
          <button
            key={lang.id}
            type="button"
            onClick={() => setActiveLang(lang.id)}
            className={cn(
              "px-3 py-1.5 text-xs rounded-md transition-colors",
              activeLang === lang.id
                ? "bg-background text-foreground shadow-sm font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {lang.label}
          </button>
        ))}
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 border-b">
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setActiveCategory(cat.id)}
            className={cn(
              "px-3 py-2 text-xs transition-colors border-b-2 -mb-px",
              activeCategory === cat.id
                ? "border-primary text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Prompt fields */}
      <div className="space-y-4">
        {filteredFields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">
                {t(field.labelKey)}
              </label>
              <button
                type="button"
                onClick={() => handleResetField(field.key)}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                {t("prompts.resetField")}
              </button>
            </div>
            <textarea
              value={prompts[field.key]?.[activeLang] ?? ""}
              onChange={(e) =>
                setPrompts((prev) =>
                  prev && {
                    ...prev,
                    [field.key]: {
                      ...prev[field.key],
                      [activeLang]: e.target.value,
                    },
                  }
                )
              }
              placeholder={t(field.hintKey)}
              rows={field.rows}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-y min-h-[36px]"
            />
          </div>
        ))}
      </div>

      <div className="flex gap-2 pt-2">
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
