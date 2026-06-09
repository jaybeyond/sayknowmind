"use client";

import * as React from "react";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import type { Block } from "@blocknote/core";
import { en as bnEn, ko as bnKo, ja as bnJa, zh as bnZh } from "@blocknote/core/locales";
import { useTheme } from "next-themes";
import { useTranslation, useI18nStore } from "@/lib/i18n";

// Built-in BlockNote UI dictionaries (slash menu, placeholders, formatting
// toolbar, etc.), keyed by our app locales. Falls back to English.
const BN_LOCALE = { en: bnEn, ko: bnKo, ja: bnJa, zh: bnZh } as const;

interface DocEditorProps {
  docId: string;
  initialTitle: string;
  initialBlocks: Block[] | null;
}

type SaveStatus = "saved" | "saving" | "unsaved";

const AUTOSAVE_DEBOUNCE_MS = 800;

export function DocEditor({ docId, initialTitle, initialBlocks }: DocEditorProps) {
  const { t } = useTranslation();
  const { resolvedTheme } = useTheme();
  const [title, setTitle] = React.useState(initialTitle);
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>("saved");
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useCreateBlockNote({
    initialContent: initialBlocks ?? undefined,
    dictionary: BN_LOCALE[useI18nStore.getState().locale] ?? bnEn,
  });

  const persist = React.useCallback(
    async (titleValue: string, blocks: Block[]) => {
      setSaveStatus("saving");
      try {
        const plaintext = blocks
          .map((b) => {
            const content = b.content;
            if (!Array.isArray(content)) return "";
            return content
              .map((inline) => (typeof inline === "object" && inline !== null && "text" in inline ? String((inline as { text: string }).text) : ""))
              .join("");
          })
          .filter(Boolean)
          .join("\n");

        await fetch(`/api/documents/${docId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: titleValue,
            content: plaintext,
            metadata: {
              blocknote: blocks,
              content_format: "blocknote",
            },
          }),
        });
        setSaveStatus("saved");
      } catch {
        setSaveStatus("unsaved");
      }
    },
    [docId],
  );

  const scheduleAutosave = React.useCallback(
    (titleValue: string, blocks: Block[]) => {
      setSaveStatus("unsaved");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void persist(titleValue, blocks);
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [persist],
  );

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    setTitle(next);
    scheduleAutosave(next, editor.document);
  };

  const handleEditorChange = () => {
    scheduleAutosave(title, editor.document);
  };

  React.useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  return (
    <div className="flex flex-col gap-4 max-w-3xl mx-auto py-10 px-4">
      <div className="flex items-center justify-between gap-4">
        <input
          type="text"
          value={title}
          onChange={handleTitleChange}
          placeholder={t("docs.untitled")}
          className="flex-1 text-3xl font-bold bg-transparent border-none outline-none placeholder:text-muted-foreground"
        />
        <span className="text-xs text-muted-foreground shrink-0">
          {saveStatus === "saving" ? t("docs.saving") : saveStatus === "unsaved" ? t("docs.unsaved") : t("docs.saved")}
        </span>
      </div>

      <BlockNoteView
        editor={editor}
        onChange={handleEditorChange}
        theme={resolvedTheme === "dark" ? "dark" : "light"}
      />
    </div>
  );
}
