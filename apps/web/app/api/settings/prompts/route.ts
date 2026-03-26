import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

const PROMPTS_FILE = join(process.cwd(), ".sayknowmind-prompts.json");

type Lang = "en" | "ko" | "zh" | "ja";
type LangPrompts = Record<Lang, string>;

export interface AllPrompts {
  // Chat prompts
  chatSystem: LangPrompts;
  chatRecommend: LangPrompts;
  chatSearch: LangPrompts;
  chatExplain: LangPrompts;
  chatCatalogFilter: LangPrompts;
  chatNoDocuments: LangPrompts;
  // Document processing prompts
  summary: LangPrompts;
  whatItSolves: LangPrompts;
  keyPoints: LangPrompts;
  tags: LangPrompts;
  entityExtraction: LangPrompts;
  categorySuggestion: LangPrompts;
}

const DEFAULT_PROMPTS: AllPrompts = {
  chatSystem: {
    en: `You are SayKnowMind, a personal knowledge assistant. The user has {{docCount}} saved documents.

RULES:
- Answer the user's ACTUAL question. Understand their intent first.
- Respond in the SAME language as the user's question.
- Be concise and natural. 2-5 sentences max.
- Do NOT list or analyze documents unless the user specifically asks to.
- Do NOT start with "Okay" or describe what the user is asking.`,
    ko: `당신은 SayKnowMind, 개인 지식 어시스턴트입니다. 사용자가 {{docCount}}개의 문서를 저장했습니다.

규칙:
- 사용자의 실제 질문에 답하세요. 의도를 먼저 파악하세요.
- 사용자의 질문과 같은 언어로 응답하세요.
- 간결하고 자연스럽게. 2-5문장 이내.
- 사용자가 명시적으로 요청하지 않는 한 문서를 나열하거나 분석하지 마세요.
- "네" 또는 "사용자가 묻고 있는 것은"으로 시작하지 마세요.`,
    zh: `你是 SayKnowMind，一个个人知识助手。用户已保存 {{docCount}} 个文档。

规则：
- 回答用户的实际问题。先理解他们的意图。
- 用与用户问题相同的语言回复。
- 简洁自然。最多2-5句。
- 除非用户明确要求，否则不要列出或分析文档。
- 不要以"好的"或描述用户在问什么开头。`,
    ja: `あなたはSayKnowMind、パーソナルナレッジアシスタントです。ユーザーは{{docCount}}件のドキュメントを保存しています。

ルール：
- ユーザーの実際の質問に答えてください。まず意図を理解してください。
- ユーザーの質問と同じ言語で応答してください。
- 簡潔で自然に。2-5文以内。
- ユーザーが明示的に求めない限り、ドキュメントを一覧表示したり分析したりしないでください。
- 「はい」やユーザーが何を聞いているかの説明から始めないでください。`,
  },
  chatRecommend: {
    en: "The user wants RECOMMENDATIONS. Format as a numbered list (2-4 items). Each item: title + one sentence why it's relevant. Do NOT write paragraphs.",
    ko: "사용자가 추천을 원합니다. 번호 목록(2-4개)으로 형식화하세요. 각 항목: 제목 + 관련 이유 한 문장. 문단으로 작성하지 마세요.",
    zh: "用户想要推荐。格式为编号列表（2-4项）。每项：标题 + 一句话说明相关性。不要写段落。",
    ja: "ユーザーはおすすめを求めています。番号付きリスト（2-4項目）で表示してください。各項目：タイトル＋関連性の一文。段落は書かないでください。",
  },
  chatSearch: {
    en: "The user wants to FIND specific content. Summarize what was found briefly. If nothing matched, say so directly.",
    ko: "사용자가 특정 콘텐츠를 찾고 있습니다. 발견된 내용을 간략히 요약하세요. 일치하는 것이 없으면 직접 말하세요.",
    zh: "用户想要查找特定内容。简要总结找到的内容。如果没有匹配的，直接说明。",
    ja: "ユーザーは特定のコンテンツを探しています。見つかった内容を簡潔にまとめてください。一致するものがない場合は、直接そう伝えてください。",
  },
  chatExplain: {
    en: "The user wants an EXPLANATION. Give a clear, direct answer using the reference material if relevant.",
    ko: "사용자가 설명을 원합니다. 참조 자료가 관련 있다면 이를 활용하여 명확하고 직접적인 답변을 하세요.",
    zh: "用户想要解释。如果参考材料相关，请给出清晰直接的回答。",
    ja: "ユーザーは説明を求めています。参考資料が関連する場合は、それを使って明確で直接的な回答をしてください。",
  },
  chatCatalogFilter: {
    en: `No direct keyword matches found. Below is the user's document catalog.
Review each document and recommend ONLY the ones that are ACTUALLY related to the user's query.
Ignore documents that are not relevant — do NOT mention irrelevant ones.
If none are relevant, say "No related documents found" (in the user's language).`,
    ko: `직접적인 키워드 일치가 없습니다. 아래는 사용자의 문서 카탈로그입니다.
각 문서를 검토하고 사용자의 질문과 실제로 관련된 것만 추천하세요.
관련 없는 문서는 무시하세요 — 언급하지 마세요.
관련된 것이 없으면 "관련된 문서가 없습니다"라고 말하세요.`,
    zh: `没有直接的关键词匹配。以下是用户的文档目录。
审查每个文档，只推荐与用户查询实际相关的文档。
忽略不相关的文档——不要提及。
如果没有相关的，请说"没有找到相关文档"。`,
    ja: `直接のキーワード一致は見つかりませんでした。以下はユーザーのドキュメントカタログです。
各ドキュメントを確認し、ユーザーのクエリに実際に関連するものだけを推薦してください。
関連のないドキュメントは無視してください——言及しないでください。
関連するものがない場合は「関連するドキュメントが見つかりませんでした」と伝えてください。`,
  },
  chatNoDocuments: {
    en: "No documents found. Answer from general knowledge.",
    ko: "문서를 찾을 수 없습니다. 일반 지식으로 답변하세요.",
    zh: "未找到文档。请根据通用知识回答。",
    ja: "ドキュメントが見つかりませんでした。一般知識で回答してください。",
  },
  summary: {
    en: "2-3 sentence summary",
    ko: "2-3문장 요약",
    zh: "2-3句摘要",
    ja: "2-3文の要約",
  },
  whatItSolves: {
    en: "1-2 sentences describing what problem/question this content addresses",
    ko: "이 콘텐츠가 다루는 문제/질문을 1-2문장으로 설명",
    zh: "1-2句描述此内容解决的问题/问题",
    ja: "このコンテンツが扱う問題/質問を1-2文で説明",
  },
  keyPoints: {
    en: "array of 3-7 key bullet points",
    ko: "3-7개의 핵심 요점 배열",
    zh: "3-7个关键要点数组",
    ja: "3-7つの重要ポイントの配列",
  },
  tags: {
    en: "array of 3-10 lowercase tags/keywords",
    ko: "3-10개의 소문자 태그/키워드 배열",
    zh: "3-10个小写标签/关键词数组",
    ja: "3-10個の小文字タグ/キーワードの配列",
  },
  entityExtraction: {
    en: `Extract named entities from the content.
Return a JSON array of objects with: "name" (original language), "type" (person/organization/location/concept/keyword/date), "confidence" (0.0-1.0).
Extract up to 20 most relevant entities. Output ONLY the JSON array.`,
    ko: `콘텐츠에서 명명된 엔티티를 추출하세요.
JSON 배열 형식으로 반환: "name" (원래 언어), "type" (person/organization/location/concept/keyword/date), "confidence" (0.0-1.0).
가장 관련성 높은 엔티티를 최대 20개 추출. JSON 배열만 출력.`,
    zh: `从内容中提取命名实体。
返回JSON数组，包含："name"（原始语言）、"type"（person/organization/location/concept/keyword/date）、"confidence"（0.0-1.0）。
提取最多20个最相关的实体。仅输出JSON数组。`,
    ja: `コンテンツから固有表現を抽出してください。
JSONの配列で返却："name"（元の言語）、"type"（person/organization/location/concept/keyword/date）、"confidence"（0.0-1.0）。
最も関連性の高い最大20のエンティティを抽出。JSON配列のみ出力。`,
  },
  categorySuggestion: {
    en: `Given the content and existing categories, suggest 1-2 categories.
RULES:
1. ALWAYS prefer existing categories. Reuse even if partial match.
2. Only suggest NEW if content truly doesn't fit any existing category.
3. Keep names broad and reusable (e.g. "Technology" not "React Tutorial").
4. Maximum 1 new category per document.
Return JSON array: [{"categoryId": "existing-id or new", "categoryName": "name", "reason": "brief", "confidence": 0.0-1.0}]`,
    ko: `콘텐츠와 기존 카테고리를 고려하여 1-2개의 카테고리를 제안하세요.
규칙:
1. 항상 기존 카테고리를 우선하세요. 부분 일치도 재사용.
2. 기존 카테고리에 맞지 않을 때만 새 카테고리 제안.
3. 이름은 넓고 재사용 가능하게 (예: "기술" 이지 "React 튜토리얼" 아님).
4. 문서당 새 카테고리 최대 1개.
JSON 배열 반환: [{"categoryId": "기존-id 또는 new", "categoryName": "이름", "reason": "간략", "confidence": 0.0-1.0}]`,
    zh: `根据内容和现有分类，建议1-2个分类。
规则：
1. 始终优先使用现有分类。即使部分匹配也要复用。
2. 只有内容确实不适合任何现有分类时才建议新分类。
3. 名称保持广泛可复用（如"技术"而非"React教程"）。
4. 每个文档最多1个新分类。
返回JSON数组：[{"categoryId": "现有id或new", "categoryName": "名称", "reason": "简述", "confidence": 0.0-1.0}]`,
    ja: `コンテンツと既存のカテゴリに基づき、1-2個のカテゴリを提案してください。
ルール：
1. 常に既存カテゴリを優先。部分一致でも再利用。
2. 既存カテゴリに合わない場合のみ新カテゴリを提案。
3. 名前は広く再利用可能に（例：「テクノロジー」であり「Reactチュートリアル」ではない）。
4. ドキュメントごとに新カテゴリは最大1つ。
JSON配列で返却：[{"categoryId": "既存IDまたはnew", "categoryName": "名前", "reason": "簡潔に", "confidence": 0.0-1.0}]`,
  },
};

function readPrompts(): AllPrompts {
  try {
    if (existsSync(PROMPTS_FILE)) {
      const data = JSON.parse(readFileSync(PROMPTS_FILE, "utf-8"));
      // Deep merge: for each key, merge lang entries
      const merged = { ...DEFAULT_PROMPTS };
      for (const key of Object.keys(DEFAULT_PROMPTS) as (keyof AllPrompts)[]) {
        if (data[key] && typeof data[key] === "object") {
          merged[key] = { ...DEFAULT_PROMPTS[key], ...data[key] };
        }
      }
      return merged;
    }
  } catch {
    // ignore
  }
  return DEFAULT_PROMPTS;
}

/** GET /api/settings/prompts — read custom prompts */
export async function GET() {
  return NextResponse.json({
    prompts: readPrompts(),
    defaults: DEFAULT_PROMPTS,
  });
}

/** POST /api/settings/prompts — save custom prompts */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const prompts = readPrompts();

    // Merge incoming per-key, per-lang
    for (const key of Object.keys(DEFAULT_PROMPTS) as (keyof AllPrompts)[]) {
      if (body[key] && typeof body[key] === "object") {
        for (const lang of ["en", "ko", "zh", "ja"] as Lang[]) {
          if (typeof body[key][lang] === "string") {
            prompts[key][lang] = body[key][lang];
          }
        }
      }
    }

    writeFileSync(PROMPTS_FILE, JSON.stringify(prompts, null, 2));
    return NextResponse.json({ prompts });
  } catch {
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}

// Helper to load prompts from server-side code
export function loadPrompts(): AllPrompts {
  return readPrompts();
}

export { DEFAULT_PROMPTS };
