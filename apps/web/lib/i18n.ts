import { create } from "zustand";
import { persist } from "zustand/middleware";
import en from "@/messages/en.json";
import ko from "@/messages/ko.json";

export type Locale = "en" | "ko";

type Messages = typeof en;

const messages: Record<Locale, Messages> = { en, ko };

interface I18nState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      locale: "en",
      setLocale: (locale: Locale) => set({ locale }),
    }),
    { name: "sayknowmind-locale" }
  )
);

/**
 * Get a nested value from an object using a dot-separated path.
 * e.g. getNestedValue(messages, "sidebar.favorites") => "Favorites"
 */
function getNestedValue(obj: Record<string, unknown>, path: string): string {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") {
      return path;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : path;
}

/**
 * Translation hook. Returns a function `t` that resolves translation keys.
 *
 * Usage:
 *   const { t, locale, setLocale } = useTranslation();
 *   t("sidebar.favorites") // "Favorites" or "즐겨찾기"
 */
export function useTranslation() {
  const { locale, setLocale } = useI18nStore();
  const t = (key: string): string => getNestedValue(messages[locale] as unknown as Record<string, unknown>, key);
  return { t, locale, setLocale };
}

export const localeNames: Record<Locale, string> = {
  en: "English",
  ko: "한국어",
};
