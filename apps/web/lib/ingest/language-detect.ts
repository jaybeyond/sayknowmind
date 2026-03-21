import { franc } from "franc-min";
import type { Language } from "@/lib/types";

// franc uses ISO 639-3 codes; map to our Language type
const ISO639_3_MAP: Record<string, Language> = {
  kor: "ko",
  eng: "en",
  jpn: "ja",
  cmn: "zh",
  zho: "zh",
};

export function detectLanguage(text: string): Language {
  // Need a minimum amount of text for reliable detection
  const sample = text.slice(0, 2000);
  const detected = franc(sample);

  if (detected === "und") {
    // Heuristic: check for CJK character prevalence
    const koCount = (sample.match(/[\uac00-\ud7af]/g) || []).length;
    const jaCount = (sample.match(/[\u3040-\u309f\u30a0-\u30ff]/g) || []).length;
    const zhCount = (sample.match(/[\u4e00-\u9fff]/g) || []).length;

    if (koCount > jaCount && koCount > zhCount && koCount > 5) return "ko";
    if (jaCount > koCount && jaCount > zhCount && jaCount > 5) return "ja";
    if (zhCount > koCount && zhCount > jaCount && zhCount > 5) return "zh";

    return "en"; // Default fallback
  }

  return ISO639_3_MAP[detected] ?? "en";
}
