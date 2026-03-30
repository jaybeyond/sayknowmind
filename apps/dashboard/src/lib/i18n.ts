/**
 * @module i18n
 * @description Internationalization configuration.
 * Supports English, Korean, Chinese, and Japanese with browser language detection.
 *
 * @implements FEAT0729 - Multi-language support (en, ko, zh, ja)
 * @implements FEAT0730 - Browser language detection
 *
 * @enforces BR0726 - Fallback to English for missing keys
 * @enforces BR0727 - Persist language preference
 */

import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";

import en from "@/locales/en.json";
import ja from "@/locales/ja.json";
import ko from "@/locales/ko.json";
import zh from "@/locales/zh.json";

export const languages = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "zh", name: "Chinese", nativeName: "中文" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
] as const;

export type LanguageCode = (typeof languages)[number]["code"];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      ko: { translation: ko },
      zh: { translation: zh },
      ja: { translation: ja },
    },
    fallbackLng: "en",
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      caches: ["localStorage"],
      lookupLocalStorage: "edgequake-language",
    },
  });

export default i18n;
