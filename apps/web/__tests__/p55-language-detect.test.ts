/**
 * Property 55: Language detection maps content to a supported UI locale.
 *
 * `lib/ingest/language-detect.ts` tags every ingested document with a language
 * used downstream for embeddings/prompts. It must always return one of the
 * supported locales (never a raw ISO-639-3 code) and fall back sensibly.
 * Previously untested.
 */
import { describe, it, expect } from "vitest";
import { detectLanguage } from "@/lib/ingest/language-detect";

const SUPPORTED = new Set(["ko", "en", "ja", "zh"]);

describe("Property 55: detectLanguage", () => {
  it("detects Korean prose", () => {
    expect(detectLanguage("오늘은 회의에서 새로운 프로젝트 일정을 논의하고 다음 분기 계획을 세웠습니다. 모두가 적극적으로 의견을 나누었습니다.")).toBe("ko");
  });

  it("detects English prose", () => {
    expect(detectLanguage("The quick brown fox jumps over the lazy dog while the committee reviews the quarterly roadmap and budget.")).toBe("en");
  });

  it("detects Japanese prose", () => {
    expect(detectLanguage("今日は会議で新しいプロジェクトの予定について話し合い、来四半期の計画を立てました。みんな積極的に意見を交換しました。")).toBe("ja");
  });

  it("detects Chinese prose", () => {
    expect(detectLanguage("今天我们在会议上讨论了新项目的时间安排，并制定了下一季度的计划。大家都积极地交换了意见和建议。")).toBe("zh");
  });

  it("falls back to English for undetectable / empty input", () => {
    expect(detectLanguage("")).toBe("en");
    expect(detectLanguage("123 456 789 !!! ??? ...")).toBe("en");
  });

  it("always returns a supported locale, never a raw ISO-639-3 code", () => {
    for (const sample of [
      "Bonjour le monde, ceci est un texte français assez long pour la détection automatique de la langue.",
      "한국어 텍스트입니다",
      "mixed 한국어 and english text here",
      "🚀🚀🚀",
      "x",
    ]) {
      expect(SUPPORTED.has(detectLanguage(sample))).toBe(true);
    }
  });

  it("uses the CJK heuristic when franc returns 'und' on short Hangul", () => {
    // short but unambiguously Korean (>5 hangul chars)
    expect(detectLanguage("안녕하세요 반갑습니다")).toBe("ko");
  });
});
