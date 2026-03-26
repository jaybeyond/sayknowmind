/**
 * Agentic chat pipeline: search → generate.
 * Stage 1: MiniLM embedding → vector search (fast, no LLM)
 * Stage 2: LLM generates answer from retrieved context
 * All stages emit SSE events through StreamWriter.
 */

import { routeChat, type ProviderInput } from "./chat-router";
import { StreamWriter, type StreamSource } from "./stream-writer";
import { queryEdgeQuake } from "@/lib/edgequake/client";
import { pool } from "@/lib/db";
import { loadPrompts } from "@/app/api/settings/prompts/route";

interface PipelineInput {
  message: string;
  conversationId: string;
  userId: string;
  history: { role: string; content: string }[];
  writer: StreamWriter;
  providers?: ProviderInput[];
}

// ── Language Detection (simple heuristic) ──────────────────────

type Lang = "en" | "ko" | "zh" | "ja";

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

type MessageIntent = "recommend" | "search" | "explain" | "general";

const INTENT_PATTERNS: [RegExp, MessageIntent][] = [
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

// ── Stage 1: Search Knowledge Base (MiniLM vector search) ────

async function searchKnowledge(
  message: string,
  userId: string,
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
    });

    const count = result.sources?.length ?? 0;
    writer.log(`EdgeQuake: ${count} results (${result.stats?.total_time_ms ?? "?"}ms)`);

    if (result.sources?.length) {
      for (const src of result.sources) {
        const docId = src.document_id ?? src.id;
        if (seenIds.has(docId)) continue;
        seenIds.add(docId);

        allSources.push({
          id: docId,
          title: docId,
          excerpt: src.snippet ?? "",
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
        const conditions = keywords.map(
          (_, i) => `(title ILIKE $${i + 2} OR content ILIKE $${i + 2})`,
        );
        const params: (string | number)[] = [userId];
        for (const kw of keywords) {
          params.push(`%${kw}%`);
        }

        const sqlQuery = `
          SELECT id, title, url, LEFT(content, 500) as excerpt,
                 (${keywords.map((_, i) =>
                   `(CASE WHEN title ILIKE $${i + 2} THEN 2 ELSE 0 END + CASE WHEN content ILIKE $${i + 2} THEN 1 ELSE 0 END)`,
                 ).join(" + ")}) as relevance
          FROM documents
          WHERE user_id = $1
            AND (${conditions.join(" OR ")})
          ORDER BY relevance DESC, updated_at DESC
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
        `SELECT id, title, url, source_type, LEFT(content, 200) as excerpt,
                metadata->>'fileType' as file_type
         FROM documents
         WHERE user_id = $1
           AND content IS NOT NULL AND content != ''
         ORDER BY updated_at DESC
         LIMIT 20`,
        [userId],
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
        `SELECT id, title, url FROM documents WHERE id = ANY($1)`,
        [ids],
      );
      const metaMap = new Map(
        metaResult.rows.map((r: { id: string; title: string; url: string | null }) => [
          r.id,
          { title: r.title, url: r.url },
        ]),
      );
      for (const src of allSources) {
        const meta = metaMap.get(src.id);
        if (meta) {
          src.title = meta.title;
          src.url = meta.url ?? undefined;
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
  writer: StreamWriter,
  intent: MessageIntent = "general",
  providers: ProviderInput[] = [],
): Promise<string> {
  writer.status("answering", "Generating answer...");

  // Get document count only — don't dump titles (overwhelms small models)
  let docCount = 0;
  try {
    const statsResult = await pool.query(
      `SELECT COUNT(*) as count FROM documents WHERE user_id = $1`,
      [userId],
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
  );

  return answerText || fullAnswer;
}

// ── Main Pipeline ───────────────────────────────────────────────

export async function runPipeline(input: PipelineInput): Promise<void> {
  const { message, conversationId, userId, history, writer, providers } = input;

  try {
    // Detect user intent (recommend / search / explain / general)
    const intent = detectIntent(message);

    // Stage 1: Vector search (MiniLM embedding, no LLM)
    const { sources, contextText, catalogText } = await searchKnowledge(message, userId, writer, intent);

    // Always generate LLM answer — sources are shown separately in the UI
    const answer = await generateAnswer(message, history, contextText, catalogText, userId, writer, intent, providers ?? []);

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
