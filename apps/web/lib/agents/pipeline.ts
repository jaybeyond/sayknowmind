/**
 * Agentic chat pipeline: search → generate.
 * Stage 1: MiniLM embedding → vector search (fast, no LLM)
 * Stage 2: LLM generates answer from retrieved context
 * All stages emit SSE events through StreamWriter.
 */

import { routeChat, type ProviderInput } from "./chat-router";
import { StreamWriter, type StreamSource } from "./stream-writer";
import { createEditorDocument, shareEditorDocument, type MindInput, type CellValue } from "./doc-actions";
import { queryEdgeQuake } from "@/lib/edgequake/client";
import { pool } from "@/lib/db";
import { loadPrompts } from "@/lib/prompts-route";
import { readableClause } from "@/lib/visibility";

interface PipelineInput {
  message: string;
  conversationId: string;
  userId: string;
  organizationId: string;
  history: { role: string; content: string }[];
  writer: StreamWriter;
  providers?: ProviderInput[];
}

// ── Language Detection (simple heuristic) ──────────────────────

type Lang = "en" | "ko" | "zh" | "ja";

/** Pick a string for the detected language (falls back to English). */
function L(lang: Lang, s: { en: string; ko: string; zh: string; ja: string }): string {
  return s[lang] ?? s.en;
}

/** Infer the editor document kind from the user's request (all 4 languages). */
function inferDocType(message: string): "doc" | "sheet" | "mindmap" {
  if (/mind\s?map|마인드\s?맵|思维导图|脑图|マインドマップ/i.test(message)) return "mindmap";
  if (/\b(sheet|spreadsheet)\b|표|스프레드시트|表格|电子表格|スプレッドシート|シート/i.test(message)) return "sheet";
  return "doc";
}

/** Pull an explicit title the user named in the message, across languages. */
function extractTitleFromMessage(message: string): string | null {
  // Explicit title markers first (highest confidence), then descriptive
  // "<name> <type>" phrasings. Order matters — e.g. "titled X" must win over
  // the generic "<word> spreadsheet" capture so it doesn't grab "create a".
  const pats: RegExp[] = [
    /제목\s*(?:은|는|:|：)?\s*['"「『]?([^'"「』\n,.]{1,40}?)['"」』]?(?:\s*(?:으로|로|이라고|라고))?\s*(?:[,.]|$)/i, // 제목은 X
    /标题\s*(?:是|为|叫|:|：)?\s*['"「『]?([^'"「』\n,，.。]{1,40})['"」』]?/i, // 标题(是/叫) X
    /タイトル\s*(?:は|:|：)?\s*['"「『]?([^'"「』\n、。]{1,40})['"」』]?/i, // タイトルは X
    /\b(?:titled|called|title)\s*[:：]?\s*['"]?([^'".\n,]{1,40}?)['"]?(?:[,.]|$)/i, // titled X
    /['"「『]([^'"」』\n]{1,40})['"」』]/, // 「X」 / "X"
    /([^\s、。「『'"]{1,40})\s*という\s*(?:ドキュメント|シート|マインドマップ|ノート|文書|表)/, // Xというドキュメント
    /([^\s、。「『'"]{1,40})の(?:マインドマップ|ドキュメント|スプレッドシート|シート|表|文書|ノート)/, // Xのマインドマップ
    /([^\s，。'"]{1,40})的(?:思维导图|脑图|文档|表格|电子表格|笔记)/, // X的思维导图
    /([^\s,.'"]{1,40}?)\s*(?:마인드맵|마인드\s?맵|문서|스프레드시트|시트|표)\b/i, // X 마인드맵
    /\b([A-Za-z][\w\s]{0,38})\s+(?:mind\s?map|document|doc|spreadsheet|sheet)\b/i, // project plan mindmap
  ];
  for (const p of pats) {
    const m = message.match(p);
    let cap = m?.[1]?.trim();
    if (!cap) continue;
    // Strip leading filler verbs the descriptive EN pattern may grab.
    cap = cap.replace(/^(?:please\s+)?(?:create|make|build|write|new|add|a|an|the)\s+/gi, "").trim();
    if (cap) return cap;
  }
  return null;
}

/** First non-empty prose line → a short, clean title (strips markdown, caps length). */
function cleanTitle(text: string): string {
  const first = text.trim().split("\n").find((l) => l.trim()) ?? "";
  const cleaned = first.replace(/^#+\s*/, "").replace(/\*\*/g, "").replace(/[:：]\s*$/, "").trim();
  return cleaned.length <= 40 ? cleaned : `${cleaned.slice(0, 40).trim()}…`;
}

/** Language-specific generic title when none can be extracted. */
function defaultDocTitle(type: "doc" | "sheet" | "mindmap", lang: Lang): string {
  const m: Record<"doc" | "sheet" | "mindmap", { en: string; ko: string; zh: string; ja: string }> = {
    doc: { en: "Untitled document", ko: "제목 없는 문서", zh: "未命名文档", ja: "無題のドキュメント" },
    sheet: { en: "Untitled spreadsheet", ko: "제목 없는 시트", zh: "未命名表格", ja: "無題のスプレッドシート" },
    mindmap: { en: "Untitled mind map", ko: "제목 없는 마인드맵", zh: "未命名思维导图", ja: "無題のマインドマップ" },
  };
  return L(lang, m[type]);
}

function detectLanguage(text: string): Lang {
  // Check for Korean characters (Hangul)
  if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(text)) return "ko";
  // Check for Japanese (Hiragana/Katakana)
  if (/[\u3040-\u309F\u30A0-\u30FF]/.test(text)) return "ja";
  // Check for Chinese (CJK Unified Ideographs — only if no Japanese kana)
  if (/[\u4E00-\u9FFF]/.test(text)) return "zh";
  return "en";
}

// ── Intent Detection (no LLM — fast regex) ────────────────────

type MessageIntent = "create" | "share" | "recommend" | "search" | "explain" | "general";

const INTENT_PATTERNS: [RegExp, MessageIntent][] = [
  // ── CREATE (KO → EN) — checked first so "만들어줘" doesn't fall to search ──
  [/만들어\s*(줘|주세요|봐|봐\s*줘|드려)/i,                                              "create"],
  [/생성\s*(해\s*줘|해\s*주세요|해\s*봐|해\s*드려)/i,                                    "create"],
  [/그려\s*(줘|주세요|봐|봐\s*줘|드려)/i,                                                "create"],
  [/작성\s*(해\s*줘|해\s*주세요|해\s*봐|해\s*드려)/i,                                    "create"],
  [/표로\s*(만들어|정리|작성)/i,                                                          "create"],
  [/마인드맵\s*(만들어|그려|생성)/i,                                                      "create"],
  [/문서\s*(만들어|작성|생성)/i,                                                          "create"],
  [/노션\s*(문서|페이지|노트)?\s*(만들어|작성|생성)/i,                                    "create"],
  [/\b(create|make|write)\s+(a\s+)?(new\s+)?(doc(ument)?|note|sheet|spreadsheet|mindmap|mind\s+map|page)\b/i, "create"],
  [/\bnew\s+(doc(ument)?|note|sheet|spreadsheet|mindmap|mind\s+map)\b/i,                  "create"],
  // ── CREATE (ZH) ──
  [/(创建|新建|生成|做一?个|写一?个|帮我(创建|新建|做|写|建|生成))\s*(新的)?\s*(文档|文件|表格|电子表格|笔记|思维导图|脑图|页面)?/, "create"],
  [/(文档|表格|电子表格|笔记|思维导图|脑图)\s*.{0,4}(创建|新建|生成|做|写|整理)/,           "create"],
  // ── CREATE (JA) ──
  [/(ドキュメント|シート|スプレッドシート|マインドマップ|ノート|文書|表)\s*(を)?\s*(作って|作成|つくって|書いて|生成)/, "create"],
  [/(作成して|作って|つくって|書いて|生成して)/,                                          "create"],

  // ── SHARE (KO → EN → ZH → JA) ────────────────────────────────
  [/공유\s*(해\s*줘|해\s*주세요|해\s*봐|해\s*드려)/i,                                    "share"],
  [/(문서|파일|노트|시트|마인드맵)를?\s*공유/i,                                          "share"],
  [/\b(share|publish)\b.{0,30}(doc(ument)?|sheet|spreadsheet|mindmap|mind\s*map|note|file)/i, "share"],
  [/(doc(ument)?|sheet|spreadsheet|mindmap|note|file).{0,20}\b(share|publish)\b/i,         "share"],
  [/(分享|共享|公开)\s*.{0,8}(文档|文件|表格|笔记|思维导图|链接|出去)?/,                   "share"],
  [/(文档|表格|笔记|思维导图|文件)\s*.{0,6}(分享|共享|公开)/,                             "share"],
  [/(共有|シェア|公開)\s*(して|してください|したい)/,                                     "share"],
  [/(ドキュメント|シート|マインドマップ|ノート|ファイル)\s*(を)?\s*.{0,6}(共有|シェア)/,  "share"],

  // ── RECOMMEND (KO → EN → ZH → JA) ─────────────────────────
  [/추천\s*(해\s*줘|해\s*주세요|드려|좀)/i,              "recommend"],
  [/좋은\s*(자료|글|영상|책|것들?)\s*있/i,              "recommend"],
  [/\b(recommend|suggest|give me|show me some)\b/i,      "recommend"],
  [/推荐|有什么好的|给我推荐/,                            "recommend"],
  [/おすすめ|オススメ|お勧め/,                            "recommend"],

  // ── SEARCH / FIND ──────────────────────────────────────────
  [/찾아\s*(줘|봐|봐\s*줘|드려|볼까)/i,                  "search"],
  [/검색\s*(해\s*줘|해\s*봐|해\s*주세요)/i,              "search"],
  [/보여\s*(줘|주세요|드려)/i,                            "search"],
  [/\b(find|search|look\s+up|locate|show\s+me)\b/i,     "search"],
  [/找|搜索|查找|帮我找/,                                 "search"],
  [/探して|検索して|見つけて/,                             "search"],

  // ── EXPLAIN ────────────────────────────────────────────────
  [/알려\s*(줘|주세요|드려)/i,                            "explain"],
  [/설명\s*(해\s*줘|해\s*주세요|드려)/i,                  "explain"],
  [/소개\s*(해\s*줘|해\s*주세요|드려|좀)/i,               "explain"],
  [/\b(explain|describe|tell me about|what is)\b/i,      "explain"],
  [/告诉我|解释|是什么/,                                   "explain"],
  [/教えて|説明して/,                                      "explain"],
];

/** Strip intent keywords to extract the actual search topic */
const INTENT_STRIP_PATTERNS: RegExp[] = [
  // Korean — typically at the end
  /\s*(추천|찾아|검색|보여|알려|설명|소개)\s*(해\s*줘|해\s*주세요|해\s*봐|드려|봐\s*줘|봐|볼까|좀)?\s*[?!.]*$/i,
  /\s*(있어|있나요?|있을까)\s*[?!.]*$/i,
  /\s*좀\s*$/i,
  // English — typically at the start
  /^(recommend|find|search\s+for|show\s+me|look\s+up|tell\s+me\s+about|explain)\s+/i,
  /\s+(please|for\s+me)\s*[?!.]*$/i,
  // Chinese — typically at the start
  /^(推荐|找|搜索|告诉我|解释)\s*/,
  /\s*(推荐|找|搜索)\s*$/,
  // Japanese — typically at the end
  /\s*(おすすめ|探して|検索して|見つけて|教えて|説明して)\s*(ください)?\s*[?!.]*$/,
  // Common filler
  /\s*(관련|관한|에\s*대해|에\s*대한|about)\s*$/i,
];

function detectIntent(message: string): MessageIntent {
  const trimmed = message.trim();
  for (const [pattern, intent] of INTENT_PATTERNS) {
    if (pattern.test(trimmed)) return intent;
  }
  return "general";
}

function extractSearchTopic(message: string, intent: MessageIntent): string {
  if (intent === "general") return message;

  let topic = message.trim();
  for (const pattern of INTENT_STRIP_PATTERNS) {
    topic = topic.replace(pattern, "").trim();
  }
  return topic.length >= 2 ? topic : message.trim();
}

/** Cross-language keyword expansion for common tech terms */
const KEYWORD_SYNONYMS: Record<string, string[]> = {
  "오픈소스": ["open source", "opensource", "github", "오픈소스"],
  "open source": ["오픈소스", "opensource", "github"],
  "ai": ["artificial intelligence", "machine learning", "인공지능", "AI"],
  "인공지능": ["ai", "artificial intelligence", "machine learning"],
  "프로그래밍": ["programming", "coding", "개발", "development"],
  "programming": ["프로그래밍", "coding", "개발"],
  "웹": ["web", "website", "frontend", "backend"],
  "디자인": ["design", "ui", "ux"],
  "데이터": ["data", "database", "데이터베이스"],
};

function expandKeywords(keywords: string[]): string[] {
  const expanded = new Set(keywords);
  for (const kw of keywords) {
    const lower = kw.toLowerCase();
    const synonyms = KEYWORD_SYNONYMS[lower];
    if (synonyms) {
      for (const syn of synonyms) expanded.add(syn);
    }
  }
  return [...expanded].slice(0, 15);
}

/** Pure greetings / filler — never need knowledge base search */
const GREETING_PATTERNS =
  /^(hi|hello|hey|yo|sup|안녕|こんにちは|你好|thanks|thank you|감사|ありがとう|고마워|잘|좋아|ㅎㅎ|ㅋㅋ|ok|okay|네|응|ㅇㅇ|ㄴㄴ|ㅇㅋ|bye|잘가)\s*[.!?~]*$/i;

/** Chitchat about the app itself or meta-conversation (NOT about saved content) */
const META_PATTERNS = [
  /^(너|넌|당신|you)\s.*(누구|뭐|이름|name|who)/i,  // "who are you"
  /몇 시|날씨|weather|time/i,                         // weather/time
  /(뭘|뭐|무엇을?)\s*(할\s*수\s*있|해\s*줄\s*수\s*있|도와)/i,  // "what can you do" / "can you help"
  /잘\s*하는\s*(거|게|것|건)|뭘?\s*잘\s*해/i,          // "what are you good at"
  /what\s+(can|do)\s+you\s+(do|help)|what.*good\s+at/i, // english version
  /기능이?\s*(뭐|뭘|어떤|알려)/i,                      // "what features"
  /어떻게\s*(사용|쓰|이용)/i,                          // "how to use"
  /^자기\s*소개|^소개\s*해\s*(줘|주세요)$|^introduce\s+yourself$/i,  // ONLY "자기소개" or bare "소개해줘"
];

function needsSearch(message: string): boolean {
  const trimmed = message.trim();

  // Pure greetings — no search
  if (GREETING_PATTERNS.test(trimmed)) return false;

  // Very short messages (< 3 chars) — no search
  if (trimmed.length < 3) return false;

  // Meta-conversation about the app — no search
  for (const pattern of META_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }

  // Everything else: search the knowledge base.
  // Korean question words (뭐, 어떻게, 왜, 알려줘, 설명해줘) are REAL queries.
  return true;
}

// ── Stage 0: Create / Share handlers ─────────────────────────

/** Strip share-intent keywords to extract the target document title. */
const SHARE_STRIP_PATTERNS: RegExp[] = [
  /\s*(공유|share|publish)\s*(해\s*줘|해\s*주세요|해\s*봐|해\s*드려)?\s*[?!.]*$/i,
  /^(share|publish|공유)\s+(the\s+)?(doc(ument)?|sheet|spreadsheet|mindmap|mind\s*map|note|file)?\s*(called|named|titled)?\s*/i,
  /\s*(문서|파일|노트|시트|마인드맵|note|doc(ument)?|sheet)\s*/i,
  /\s*좀\s*$/i,
  // ZH / JA share verbs + document nouns
  /(分享|共享|公开|帮我)\s*/g,
  /(文档|文件|表格|笔记|思维导图)\s*/g,
  /(共有|シェア|公開)\s*(して|してください|したい)?/g,
  /(ドキュメント|シート|マインドマップ|ノート|ファイル)\s*(を)?\s*/g,
];

function extractShareTarget(message: string): string {
  let target = message.trim();
  for (const p of SHARE_STRIP_PATTERNS) {
    target = target.replace(p, "").trim();
  }
  return target;
}

/**
 * Handle a "create" intent:
 *  1. Ask the LLM (silently) to extract { type, title, markdown/rows/mindmap } from the message.
 *  2. Call createEditorDocument in-process.
 *  3. Stream a short confirmation with the doc link.
 *  Returns the answer text for DB storage.
 */
async function handleCreate(
  message: string,
  userId: string,
  organizationId: string,
  writer: StreamWriter,
  providers: ProviderInput[],
): Promise<string> {
  const lang = detectLanguage(message);
  writer.status("thinking", L(lang, { en: "Creating document...", ko: "문서를 생성하는 중...", zh: "正在创建文档...", ja: "ドキュメントを作成中..." }));
  writer.log("Create intent detected — extracting document parameters via LLM");

  const extractionSystem = `You are a structured data extraction assistant.
The user wants to create an editor document. Extract the creation parameters and return ONLY a valid JSON object with these fields:
- "type": "doc" | "sheet" | "mindmap"  (required; infer from keywords: sheet/표/스프레드시트→sheet, mindmap/마인드맵→mindmap, else→doc)
- "title": string  (required; extract from user message or infer a short descriptive title)
- "markdown": string  (type=doc only: document body as Markdown; use # headings, - lists, \`\`\` code blocks)
- "rows": array of arrays  (type=sheet only: 2D cell values, e.g. [["Name","Score"],["Kim",90]])
- "sheetName": string  (type=sheet only: worksheet name, default "Sheet1")
- "mindmap": { "topic": string, "children": [{ "topic": string, "children": [...] }] }  (type=mindmap only)

Include only the field that matches the type. Return ONLY the raw JSON object — no markdown fence, no explanation.`;

  let extracted = "";
  try {
    extracted = await routeChat(
      providers,
      extractionSystem,
      [{ role: "user", content: message }],
      () => {}, // silent — no tokens to client during extraction
      undefined,
      (msg) => writer.log(msg),
      userId,
      // omit organizationId: this is an internal extraction call, not a
      // user-facing conversation, and some AI server versions reject the field
    );
    writer.log(`Extracted params: ${extracted.slice(0, 120)}`);
  } catch (err) {
    writer.log(`LLM extraction failed: ${(err as Error).message} — using fallback`);
  }

  // Parse extracted JSON.
  // Strategy 1: pure JSON or markdown-fenced JSON.
  // Strategy 2: if LLM returned prose (e.g. the document content itself),
  //   use the first non-empty line as the title and the whole response as content.
  // Strategy 3: fall back to the user's original message as the doc body.
  type ExtractedParams = {
    type: "doc" | "sheet" | "mindmap";
    title: string;
    markdown?: string;
    rows?: CellValue[][];
    sheetName?: string;
    mindmap?: MindInput;
  };

  let docParams: ExtractedParams | null = null;

  // Strategy 1 — try JSON parse (handles both raw JSON and ```json fences)
  const jsonCandidate = extracted
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  try {
    const parsed = JSON.parse(jsonCandidate) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "type" in parsed &&
      "title" in parsed &&
      typeof (parsed as Record<string, unknown>).type === "string" &&
      typeof (parsed as Record<string, unknown>).title === "string"
    ) {
      docParams = parsed as ExtractedParams;
    }
  } catch {
    // not JSON — try prose extraction below
  }

  // Strategy 2 — LLM returned prose instead of JSON. Infer the kind from the
  // user's request (all 4 languages) and derive a clean title. Only a doc can
  // absorb prose as its body; a sheet/mindmap needs structured input the
  // prose-only response didn't give, so it's created titled-but-empty (correct
  // type beats a doc full of the model's prose).
  if (!docParams && extracted.trim().length > 0) {
    const inferredType = inferDocType(message);
    const title =
      extractTitleFromMessage(message) ??
      (inferredType === "doc" ? cleanTitle(extracted) || defaultDocTitle(inferredType, lang) : defaultDocTitle(inferredType, lang));
    writer.log(`Prose response — inferred type=${inferredType}, title="${title}"`);
    docParams = {
      type: inferredType,
      title,
      markdown: inferredType === "doc" ? extracted : undefined,
    };
  }

  // Strategy 3 — nothing worked (empty LLM response); still honour the requested
  // type and title, with the user's message as the doc body.
  if (!docParams || !["doc", "sheet", "mindmap"].includes(docParams.type ?? "")) {
    const inferredType = inferDocType(message);
    docParams = {
      type: inferredType,
      title: extractTitleFromMessage(message) ?? defaultDocTitle(inferredType, lang),
      markdown: inferredType === "doc" ? message : undefined,
    };
  }

  writer.status(
    "thinking",
    L(lang, {
      en: `Creating '${docParams.title}'...`,
      ko: `'${docParams.title}' 생성 중...`,
      zh: `正在创建『${docParams.title}』...`,
      ja: `『${docParams.title}』を作成中...`,
    }),
  );

  let docResult: { id: string; url: string };
  try {
    docResult = await createEditorDocument({
      userId,
      organizationId,
      type: docParams.type,
      title: docParams.title,
      markdown: docParams.markdown,
      rows: docParams.rows,
      sheetName: docParams.sheetName,
      mindmap: docParams.mindmap,
    });
    writer.log(`Created ${docParams.type} '${docParams.title}' → id: ${docResult.id}`);
  } catch (err) {
    const errMsg = (err as Error).message;
    writer.log(`Document creation failed: ${errMsg}`);
    const errorAnswer = L(lang, {
      en: `Failed to create document: ${errMsg}`,
      ko: `문서 생성에 실패했습니다: ${errMsg}`,
      zh: `创建文档失败：${errMsg}`,
      ja: `ドキュメントの作成に失敗しました: ${errMsg}`,
    });
    writer.token(errorAnswer);
    return errorAnswer;
  }

  const labels: Record<"doc" | "sheet" | "mindmap", Record<Lang, string>> = {
    doc: { en: "document", ko: "문서", zh: "文档", ja: "ドキュメント" },
    sheet: { en: "spreadsheet", ko: "스프레드시트", zh: "表格", ja: "スプレッドシート" },
    mindmap: { en: "mind map", ko: "마인드맵", zh: "思维导图", ja: "マインドマップ" },
  };
  const typeLabel = labels[docParams.type][lang];
  // Korean object particle: 마인드맵 ends in a consonant (을); 문서/스프레드시트 in a vowel (를).
  const particle = docParams.type === "mindmap" ? "을" : "를";
  const answer = L(lang, {
    en: `Created **${docParams.title}** ${typeLabel}. [Open it](${docResult.url})`,
    ko: `**${docParams.title}** ${typeLabel}${particle} 만들었습니다. [열기](${docResult.url})`,
    zh: `已创建 **${docParams.title}** ${typeLabel}。[打开](${docResult.url})`,
    ja: `**${docParams.title}** ${typeLabel}を作成しました。[開く](${docResult.url})`,
  });

  writer.token(answer);
  return answer;
}

/**
 * Handle a "share" intent:
 *  1. Extract a target document title from the message (regex strip).
 *  2. Fuzzy-search the user's documents by title.
 *  3. If found → call shareEditorDocument, stream the share link.
 *  4. If not found → ask the user to specify.
 *  Returns the answer text for DB storage.
 */
async function handleShare(
  message: string,
  userId: string,
  writer: StreamWriter,
): Promise<string> {
  const lang = detectLanguage(message);
  writer.status("thinking", L(lang, { en: "Sharing document...", ko: "문서를 공유하는 중...", zh: "正在分享文档...", ja: "ドキュメントを共有中..." }));

  const titleQuery = extractShareTarget(message);
  writer.log(`Share intent — title query: "${titleQuery}"`);

  let docId: string | null = null;
  let docTitle = "";

  try {
    // Primary, language-agnostic match: find a document whose TITLE appears
    // inside the user's message ("把회의록 공유" / "把会议记录分享出去" all contain
    // the real title). Prefer the most specific (longest) title. This sidesteps
    // brittle per-language keyword stripping. Fall back to a fuzzy ILIKE on the
    // stripped query, then to most-recently-updated.
    const result = await pool.query(
      `SELECT id, title,
              ($3::text ILIKE '%' || title || '%' AND char_length(title) >= 2) AS in_message
         FROM documents
        WHERE user_id = $1
          AND ( ($3::text ILIKE '%' || title || '%' AND char_length(title) >= 2)
                OR ($2 <> '' AND title ILIKE $2) )
        ORDER BY in_message DESC, char_length(title) DESC, updated_at DESC
        LIMIT 1`,
      [userId, titleQuery ? `%${titleQuery}%` : "", message],
    );
    if (result.rows.length > 0) {
      docId = result.rows[0].id as string;
      docTitle = result.rows[0].title as string;
    }
  } catch (err) {
    writer.log(`Document lookup failed: ${(err as Error).message}`);
  }

  if (!docId) {
    const ask = L(lang, {
      en: "Which document would you like to share? Please tell me the document title.",
      ko: "어떤 문서를 공유할까요? 문서 제목을 알려주세요.",
      zh: "您想分享哪个文档？请告诉我文档标题。",
      ja: "どのドキュメントを共有しますか？タイトルを教えてください。",
    });
    writer.token(ask);
    return ask;
  }

  writer.log(`Sharing doc: ${docId} ("${docTitle}")`);

  let shareResult: { shareToken: string; url: string };
  try {
    shareResult = await shareEditorDocument({ documentId: docId, userId });
    writer.log(`Share token: ${shareResult.shareToken}`);
  } catch (err) {
    const errMsg = (err as Error).message;
    writer.log(`Share failed: ${errMsg}`);
    const errorAnswer = L(lang, {
      en: `Failed to share document: ${errMsg}`,
      ko: `문서 공유에 실패했습니다: ${errMsg}`,
      zh: `分享文档失败：${errMsg}`,
      ja: `ドキュメントの共有に失敗しました: ${errMsg}`,
    });
    writer.token(errorAnswer);
    return errorAnswer;
  }

  const answer = L(lang, {
    en: `Shared **${docTitle}**. [Share link](${shareResult.url})`,
    ko: `**${docTitle}** 문서를 공유했습니다. [공유 링크](${shareResult.url})`,
    zh: `已分享 **${docTitle}**。[分享链接](${shareResult.url})`,
    ja: `**${docTitle}** を共有しました。[共有リンク](${shareResult.url})`,
  });

  writer.token(answer);
  return answer;
}

// ── Stage 1: Search Knowledge Base (MiniLM vector search) ────

async function searchKnowledge(
  message: string,
  userId: string,
  organizationId: string,
  writer: StreamWriter,
  intent: MessageIntent = "general",
): Promise<{ sources: StreamSource[]; contextText: string; catalogText: string }> {
  if (!needsSearch(message)) {
    writer.status("thinking", "Processing...");
    writer.log("Conversational query — skipping knowledge base search");
    return { sources: [], contextText: "", catalogText: "" };
  }

  // Extract clean search topic — strips "추천해줘", "find", etc.
  const searchQuery = extractSearchTopic(message, intent);

  writer.status("searching", "Searching your knowledge base...");
  if (intent !== "general") {
    writer.log(`Intent: ${intent}`);
  }
  if (searchQuery !== message.trim()) {
    writer.log(`Search topic: "${searchQuery}" (from: "${message}")`);
  } else {
    writer.log(`Query: "${message}"`);
  }

  const allSources: StreamSource[] = [];
  const seenIds = new Set<string>();

  // EdgeQuake vector search (naive mode = pure embedding, no LLM keyword extraction)
  try {
    const result = await queryEdgeQuake({
      query: searchQuery,
      mode: "naive",
      include_references: true,
      max_results: 5,
      userId,
    });

    const count = result.sources?.length ?? 0;
    writer.log(`EdgeQuake: ${count} results (${result.stats?.total_time_ms ?? "?"}ms)`);

    if (result.sources?.length) {
      const candidateIds = Array.from(
        new Set(
          result.sources
            .map((src) => src.document_id ?? src.id)
            .filter((id): id is string => Boolean(id)),
        ),
      );
      const visibleDocMap = new Map<
        string,
        { title: string; url: string | null; summary: string | null; content: string | null }
      >();
      if (candidateIds.length > 0) {
        const visibleDocs = await pool.query(
          `SELECT d.id, d.title, d.url, d.summary, d.content
           FROM documents d
           WHERE d.id = ANY($1) AND ${readableClause("d", 3, 2, "document")}`,
          [candidateIds, userId, organizationId],
        );
        for (const row of visibleDocs.rows as Array<{
          id: string;
          title: string;
          url: string | null;
          summary: string | null;
          content: string | null;
        }>) {
          visibleDocMap.set(row.id, row);
        }
      }

      for (const src of result.sources) {
        const docId = src.document_id ?? src.id;
        if (!docId || seenIds.has(docId)) continue;
        const doc = visibleDocMap.get(docId);
        if (!doc) continue;
        seenIds.add(docId);

        allSources.push({
          id: docId,
          title: doc.title,
          url: doc.url ?? undefined,
          excerpt: src.snippet || doc.summary || doc.content?.slice(0, 500) || "",
          score: src.score,
        });
      }
    }
  } catch {
    writer.log("EdgeQuake unavailable — falling back to database search");
  }

  // Fallback: PostgreSQL text search
  if (allSources.length === 0) {
    writer.log("Trying database text search...");
    try {
      const rawKeywords = searchQuery
        .split(/\s+/)
        .filter((w) => w.length >= 2)
        .slice(0, 10);
      const keywords = expandKeywords(rawKeywords);

      if (keywords.length > 0) {
        // params[0]=userId ($1), params[1]=organizationId ($2) — fixed; keywords start at $3
        const conditions = keywords.map(
          (_, i) => `(d.title ILIKE $${i + 3} OR d.content ILIKE $${i + 3})`,
        );
        const params: (string | number)[] = [userId, organizationId];
        for (const kw of keywords) {
          params.push(`%${kw}%`);
        }

        const sqlQuery = `
          SELECT d.id, d.title, d.url, LEFT(d.content, 500) as excerpt,
                 (${keywords.map((_, i) =>
                   `(CASE WHEN d.title ILIKE $${i + 3} THEN 2 ELSE 0 END + CASE WHEN d.content ILIKE $${i + 3} THEN 1 ELSE 0 END)`,
                 ).join(" + ")}) as relevance
          FROM documents d
          WHERE ${readableClause("d", 2, 1, "document")}
            AND (${conditions.join(" OR ")})
          ORDER BY relevance DESC, d.updated_at DESC
          LIMIT 5
        `;

        const dbResult = await pool.query(sqlQuery, params);
        writer.log(`Database: ${dbResult.rowCount ?? 0} results`);

        for (const row of dbResult.rows) {
          if (seenIds.has(row.id)) continue;
          seenIds.add(row.id);

          const maxScore = keywords.length * 3;
          allSources.push({
            id: row.id,
            title: row.title,
            url: row.url ?? undefined,
            excerpt: row.excerpt ?? "",
            score: Math.min(row.relevance / maxScore, 1),
          });
        }
      }
    } catch (err) {
      writer.log(`Database search failed: ${(err as Error).message}`);
    }
  }

  // When keyword search fails + non-general intent:
  // Load document catalog for LLM-based semantic filtering.
  // The LLM will decide which documents are relevant to the query.
  let catalogText = "";
  if (allSources.length === 0 && intent !== "general") {
    writer.log("No keyword matches — loading document catalog for LLM filtering...");
    try {
      const catalogResult = await pool.query(
        `SELECT d.id, d.title, d.url, d.source_type, LEFT(d.content, 200) as excerpt,
                d.metadata->>'fileType' as file_type
         FROM documents d
         WHERE ${readableClause("d", 2, 1, "document")}
           AND d.content IS NOT NULL AND d.content != ''
         ORDER BY d.updated_at DESC
         LIMIT 20`,
        [userId, organizationId],
      );
      writer.log(`Loaded ${catalogResult.rowCount ?? 0} documents for LLM filtering`);

      if (catalogResult.rows.length > 0) {
        catalogText = catalogResult.rows
          .map((r: { title: string; url?: string; excerpt?: string; file_type?: string }, i: number) => {
            const meta = [r.url, r.file_type].filter(Boolean).join(" | ");
            return `[${i + 1}] ${r.title}${meta ? ` (${meta})` : ""}\n${(r.excerpt ?? "").slice(0, 150)}`;
          })
          .join("\n\n");
      }
    } catch (err) {
      writer.log(`Failed to load document catalog: ${(err as Error).message}`);
    }
  } else if (allSources.length === 0) {
    writer.log("No relevant sources found");
  }

  // Enrich EdgeQuake results with document metadata from PostgreSQL
  if (allSources.length > 0 && !allSources[0].url) {
    try {
      const ids = allSources.map((s) => s.id);
      const metaResult = await pool.query(
        `SELECT d.id, d.title, d.url
         FROM documents d
         WHERE d.id = ANY($1) AND ${readableClause("d", 3, 2, "document")}`,
        [ids, userId, organizationId],
      );
      const metaMap = new Map<string, { title: string; url: string | null }>(
        metaResult.rows.map((r: { id: string; title: string; url: string | null }) => [
          r.id,
          { title: r.title, url: r.url },
        ]),
      );
      for (const src of allSources) {
        const meta = metaMap.get(src.id);
        if (meta) {
          (src as unknown as Record<string, unknown>).title = meta.title;
          (src as unknown as Record<string, unknown>).url = meta.url ?? undefined;
        }
      }
    } catch {
      // metadata enrichment not critical
    }
  }

  // Sort by score, take top 5
  allSources.sort((a, b) => b.score - a.score);
  const topSources = allSources.slice(0, 5);

  if (topSources.length > 0) {
    writer.log(`Top ${topSources.length} sources:`);
    for (const src of topSources) {
      writer.log(`  [${Math.round(src.score * 100)}%] ${src.title}`);
    }
    writer.sources(topSources);
  } else {
    writer.log("No relevant sources found");
  }

  const contextText = topSources
    .map((s, i) => `[${i + 1}] ${s.title}\n${s.excerpt}`)
    .join("\n\n");

  return { sources: topSources, contextText, catalogText };
}

// ── Stage 2: Generate Answer (LLM) ──────────────────────────

async function generateAnswer(
  message: string,
  history: { role: string; content: string }[],
  contextText: string,
  catalogText: string,
  userId: string,
  organizationId: string,
  writer: StreamWriter,
  intent: MessageIntent = "general",
  providers: ProviderInput[] = [],
): Promise<string> {
  writer.status("answering", "Generating answer...");

  // Get document count only — don't dump titles (overwhelms small models)
  let docCount = 0;
  try {
    const statsResult = await pool.query(
      `SELECT COUNT(*) as count FROM documents WHERE organization_id = $1`,
      [organizationId],
    );
    docCount = parseInt(statsResult.rows[0]?.count ?? "0", 10);
  } catch {
    // stats not critical
  }

  if (contextText) {
    writer.log(`Answering with ${contextText.split("[").length - 1} sources`);
  } else {
    writer.log("Answering from general knowledge");
  }

  // Load customizable prompts
  const prompts = loadPrompts();

  // Detect user language from message (simple heuristic)
  const lang = detectLanguage(message);

  // System prompt from config
  let systemPromptText = (prompts.chatSystem[lang] ?? prompts.chatSystem.en)
    .replace(/\{\{docCount\}\}/g, String(docCount));

  // Intent-specific instructions from config
  if (intent === "recommend") {
    systemPromptText += `\n\n${prompts.chatRecommend[lang] ?? prompts.chatRecommend.en}`;
  } else if (intent === "search") {
    systemPromptText += `\n\n${prompts.chatSearch[lang] ?? prompts.chatSearch.en}`;
  } else if (intent === "explain") {
    systemPromptText += `\n\n${prompts.chatExplain[lang] ?? prompts.chatExplain.en}`;
  }

  if (contextText) {
    systemPromptText += `\n\nReference material:\n${contextText}\n\nCite as [1], [2] when using information from them.`;
  } else if (catalogText) {
    systemPromptText += `\n\n${prompts.chatCatalogFilter[lang] ?? prompts.chatCatalogFilter.en}\n\nDocument catalog:\n${catalogText}`;
  } else {
    systemPromptText += `\n\n${prompts.chatNoDocuments[lang] ?? prompts.chatNoDocuments.en}`;
  }

  const messages = [
    ...history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  writer.log("Streaming response from LLM...");

  let answerText = "";

  const fullAnswer = await routeChat(
    providers,
    systemPromptText,
    messages,
    // Content tokens → stream directly to client
    (token) => {
      answerText += token;
      writer.token(token);
    },
    // Reasoning tokens → show in UI as thinking logs
    (line) => {
      writer.log(line);
    },
    // Router log messages
    (msg) => {
      writer.log(msg);
    },
    // userId — required for OCP/Codex relay routing
    userId,
    // organizationId — scopes AI server memory to the caller's team
    organizationId,
  );

  return answerText || fullAnswer;
}

// ── Main Pipeline ───────────────────────────────────────────────

export async function runPipeline(input: PipelineInput): Promise<void> {
  const { message, conversationId, userId, organizationId, history, writer, providers } = input;

  try {
    // Detect user intent (create / share / recommend / search / explain / general)
    const intent = detectIntent(message);

    // Branch: create / share — skip RAG entirely, act directly on documents
    if (intent === "create" || intent === "share") {
      const answer =
        intent === "create"
          ? await handleCreate(message, userId, organizationId, writer, providers ?? [])
          : await handleShare(message, userId, writer);

      let messageId = "";
      try {
        const insertResult = await pool.query(
          `INSERT INTO messages (conversation_id, role, content, citations)
           VALUES ($1, 'assistant', $2, $3::jsonb)
           RETURNING id`,
          [conversationId, answer, JSON.stringify([])],
        );
        messageId = insertResult.rows[0]?.id ?? "";
        await pool.query(
          `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
          [conversationId],
        );
      } catch (err) {
        console.error("[pipeline] Failed to store create/share message:", err);
      }

      writer.done({ conversationId, messageId });
      return;
    }

    // Stage 1: Vector search (MiniLM embedding, no LLM)
    const { sources, contextText, catalogText } = await searchKnowledge(message, userId, organizationId, writer, intent);

    // Always generate LLM answer — sources are shown separately in the UI
    const answer = await generateAnswer(message, history, contextText, catalogText, userId, organizationId, writer, intent, providers ?? []);

    // Store assistant message with citations
    const citations = sources.map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url ?? null,
      excerpt: s.excerpt,
      score: s.score,
    }));

    let messageId = "";
    try {
      const insertResult = await pool.query(
        `INSERT INTO messages (conversation_id, role, content, citations)
         VALUES ($1, 'assistant', $2, $3::jsonb)
         RETURNING id`,
        [conversationId, answer, JSON.stringify(citations)],
      );
      messageId = insertResult.rows[0]?.id ?? "";

      await pool.query(
        `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
        [conversationId],
      );
    } catch (err) {
      console.error("[pipeline] Failed to store message:", err);
    }

    writer.done({ conversationId, messageId });
  } catch (err) {
    console.error("[pipeline] Error:", err);
    writer.error("An error occurred while processing your request.");
  } finally {
    writer.close();
  }
}
