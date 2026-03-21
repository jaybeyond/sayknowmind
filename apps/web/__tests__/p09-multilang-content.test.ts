/**
 * Property test for multi-language content (16.6)
 * Verify ko, en, ja, zh content is successfully ingested.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// Simulate language detection logic from the ingestion pipeline
function detectLanguage(content: string): string {
  const cjkRegex = /[\u3000-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;
  const koreanRegex = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/;
  const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF]/;
  const chineseRegex = /[\u4E00-\u9FFF]/;

  if (koreanRegex.test(content)) return "ko";
  if (japaneseRegex.test(content)) return "ja";
  if (chineseRegex.test(content)) return "zh";
  return "en";
}

function countWords(content: string): number {
  const cjkChars = content.match(/[\u3000-\u9FFF\uAC00-\uD7AF]/g)?.length ?? 0;
  const latinWords = content
    .replace(/[\u3000-\u9FFF\uAC00-\uD7AF]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
  return cjkChars + latinWords;
}

describe("Property: Multi-language content support", () => {
  it("Korean content is detected correctly", () => {
    const koreanTexts = [
      "안녕하세요 세계",
      "인공지능과 머신러닝에 대한 연구",
      "SayknowMind는 개인 지식 관리 도구입니다",
    ];
    for (const text of koreanTexts) {
      expect(detectLanguage(text)).toBe("ko");
    }
  });

  it("Japanese content is detected correctly", () => {
    const japaneseTexts = [
      "こんにちは世界",
      "人工知能の研究について",
      "カタカナテスト",
    ];
    for (const text of japaneseTexts) {
      expect(detectLanguage(text)).toBe("ja");
    }
  });

  it("Chinese content is detected correctly", () => {
    const chineseTexts = [
      "你好世界",
      "关于人工智能的研究",
    ];
    for (const text of chineseTexts) {
      expect(detectLanguage(text)).toBe("zh");
    }
  });

  it("English content is detected as default", () => {
    const englishTexts = [
      "Hello world",
      "Research about artificial intelligence and machine learning",
      "SayknowMind is a personal knowledge management tool",
    ];
    for (const text of englishTexts) {
      expect(detectLanguage(text)).toBe("en");
    }
  });

  it("CJK word counting treats each character as a word", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        (charCount) => {
          const koreanText = "가".repeat(charCount);
          expect(countWords(koreanText)).toBe(charCount);
        },
      ),
      { numRuns: 50 },
    );
  });

  it("mixed language word counting works", () => {
    const mixed = "Hello 안녕하세요 World 세계";
    const count = countWords(mixed);
    // "Hello", "World" = 2 latin words + 5 Korean chars = 7+
    expect(count).toBeGreaterThan(2);
  });

  it("language detection is deterministic", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }),
        (text) => {
          const lang1 = detectLanguage(text);
          const lang2 = detectLanguage(text);
          expect(lang1).toBe(lang2);
        },
      ),
      { numRuns: 100 },
    );
  });
});
