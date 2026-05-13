import type { CategorySuggestion, Language } from "@/lib/types";

interface ExistingCategory {
  id: string;
  name: string;
}

interface TopicRule {
  id: string;
  label: Record<Language, string>;
  aliases: string[];
  keywords: RegExp[];
}

const TOPIC_RULES: TopicRule[] = [
  {
    id: "ai",
    label: { ko: "AI", en: "AI", ja: "AI", zh: "AI" },
    aliases: [
      "ai",
      "artificial intelligence",
      "인공지능",
      "人工智能",
      "智能体",
      "人工知能",
      "エージェント",
    ],
    keywords: [
      /\bai\b/i,
      /\bllm\b/i,
      /\brag\b/i,
      /\bagentic\b/i,
      /\bagents?\b/i,
      /\bopenai\b/i,
      /\bchatgpt\b/i,
      /\bgpt[-\w]*\b/i,
      /\bclaude\b/i,
      /\bollama\b/i,
      /\bmodel(?:s)?\b/i,
      /\bworkflow(?:s)?\b/i,
      /인공지능|에이전트|워크플로우|대규모\s*언어\s*모델|생성형\s*AI/i,
      /人工智能|智能体|工作流|大模型|语言模型|生成式\s*AI/i,
      /人工知能|エージェント|ワークフロー|大規模言語モデル|生成AI/i,
    ],
  },
  {
    id: "development",
    label: { ko: "개발", en: "Development", ja: "開発", zh: "开发" },
    aliases: ["development", "software", "programming", "개발", "프로그래밍", "开发", "代码", "開発"],
    keywords: [
      /\bsoftware\b/i,
      /\bcode\b/i,
      /\bcoding\b/i,
      /\bprogramming\b/i,
      /\bgithub\b/i,
      /\bapi\b/i,
      /\bsdk\b/i,
      /\btypescript\b/i,
      /\bjavascript\b/i,
      /\breact\b/i,
      /\bnext\.?js\b/i,
      /\bpython\b/i,
      /\brust\b/i,
      /\bframework\b/i,
      /개발|프로그래밍|소프트웨어|코드|프레임워크/i,
      /开发|代码|编程|软件|框架/i,
      /開発|コード|プログラミング|ソフトウェア|フレームワーク/i,
    ],
  },
  {
    id: "business",
    label: { ko: "비즈니스", en: "Business", ja: "ビジネス", zh: "商业" },
    aliases: ["business", "startup", "market", "비즈니스", "스타트업", "商业", "创业", "ビジネス"],
    keywords: [
      /\bbusiness\b/i,
      /\bstartup\b/i,
      /\bmarket(?:ing)?\b/i,
      /\bsales\b/i,
      /\brevenue\b/i,
      /\bgrowth\b/i,
      /\bstrategy\b/i,
      /비즈니스|스타트업|시장|마케팅|매출|성장|전략/i,
      /商业|创业|市场|营销|收入|增长|战略/i,
      /ビジネス|スタートアップ|市場|マーケティング|収益|成長|戦略/i,
    ],
  },
  {
    id: "design",
    label: { ko: "디자인", en: "Design", ja: "デザイン", zh: "设计" },
    aliases: ["design", "ux", "ui", "디자인", "设计", "デザイン"],
    keywords: [
      /\bdesign\b/i,
      /\bui\b/i,
      /\bux\b/i,
      /\bfigma\b/i,
      /\bprototype\b/i,
      /디자인|사용자\s*경험|프로토타입/i,
      /设计|用户体验|原型/i,
      /デザイン|ユーザー体験|プロトタイプ/i,
    ],
  },
  {
    id: "research",
    label: { ko: "리서치", en: "Research", ja: "リサーチ", zh: "研究" },
    aliases: ["research", "paper", "study", "리서치", "연구", "研究", "論文"],
    keywords: [
      /\bresearch\b/i,
      /\bpaper\b/i,
      /\bstudy\b/i,
      /\barxiv\b/i,
      /\bexperiment\b/i,
      /리서치|연구|논문|실험/i,
      /研究|论文|實驗|实验/i,
      /リサーチ|研究|論文|実験/i,
    ],
  },
];

function normalize(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s_\-–—/|()[\]{}:;,.]+/g, "");
}

function matchesExistingCategory(
  existing: ExistingCategory[],
  rule: TopicRule,
): ExistingCategory | null {
  const candidates = [rule.label.ko, rule.label.en, rule.label.ja, rule.label.zh, ...rule.aliases]
    .map(normalize)
    .filter(Boolean);

  return existing.find((category) => {
    const categoryName = normalize(category.name);
    return candidates.some((candidate) =>
      categoryName === candidate || categoryName.includes(candidate) || candidate.includes(categoryName),
    );
  }) ?? null;
}

function scoreRule(text: string, rule: TopicRule): number {
  return rule.keywords.reduce((score, keyword) => score + (keyword.test(text) ? 1 : 0), 0);
}

function findDirectExistingMatch(
  text: string,
  existing: ExistingCategory[],
): ExistingCategory | null {
  const normalizedText = normalize(text);
  return existing.find((category) => {
    const name = normalize(category.name);
    return name.length >= 2 && normalizedText.includes(name);
  }) ?? null;
}

/**
 * Deterministic category fallback used when the LLM returns no usable
 * suggestion. It only emits broad, reusable topics and prefers existing
 * categories whenever one matches the detected topic.
 */
export function suggestFallbackCategory(params: {
  title?: string | null;
  content: string;
  existingCategories: ExistingCategory[];
  language: Language;
}): CategorySuggestion | null {
  const text = `${params.title ?? ""}\n${params.content}`.slice(0, 16_000);
  const directExisting = findDirectExistingMatch(text, params.existingCategories);
  if (directExisting) {
    return {
      categoryId: directExisting.id,
      categoryName: directExisting.name,
      reason: "fallback_existing_name_match",
      confidence: 0.58,
    };
  }

  const ranked = TOPIC_RULES
    .map((rule) => ({ rule, score: scoreRule(text, rule) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best) return null;

  const existing = matchesExistingCategory(params.existingCategories, best.rule);
  if (existing) {
    return {
      categoryId: existing.id,
      categoryName: existing.name,
      reason: `fallback_topic_match:${best.rule.id}`,
      confidence: 0.62,
    };
  }

  return {
    categoryId: "new",
    categoryName: best.rule.label[params.language],
    reason: `fallback_topic_create:${best.rule.id}`,
    confidence: 0.72,
  };
}
