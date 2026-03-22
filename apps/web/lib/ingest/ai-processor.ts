import type { EntityType, Language, CategorySuggestion } from "@/lib/types";

const AI_SERVER_URL = process.env.AI_SERVER_URL ?? "http://localhost:4000";
const AI_API_KEY = process.env.AI_API_KEY ?? "";
const AI_TIMEOUT = 60_000;
const MAX_CONTENT_CHARS = 8000;

const LLM_PROVIDER = process.env.LLM_PROVIDER ?? "server";
const LLM_MODEL = process.env.LLM_MODEL ?? "llama3.2";
const OLLAMA_URL = `http://localhost:${process.env.OLLAMA_PORT ?? "11434"}`;

interface AiChatRequest {
  system: string;
  message: string;
}

interface ExtractedEntity {
  name: string;
  type: EntityType;
  confidence: number;
}

async function callOllama(req: AiChatRequest): Promise<string> {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.message },
      ],
      stream: false,
    }),
    signal: AbortSignal.timeout(AI_TIMEOUT),
  });

  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}`);
  }

  const data = await response.json();
  return data.message?.content ?? "";
}

async function callAiServer(req: AiChatRequest): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (AI_API_KEY) headers["Authorization"] = `Bearer ${AI_API_KEY}`;

  const response = await fetch(`${AI_SERVER_URL}/ai/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ system: req.system, message: req.message }),
    signal: AbortSignal.timeout(AI_TIMEOUT),
  });

  if (!response.ok) {
    throw new Error(`AI server returned ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return data.response ?? data.message ?? data.content ?? "";
}

async function callAi(req: AiChatRequest): Promise<string> {
  if (LLM_PROVIDER === "ollama") {
    try {
      return await callOllama(req);
    } catch (err) {
      console.warn("[ai-processor] Ollama unavailable, falling back to AI server:", err);
      return await callAiServer(req);
    }
  }
  return await callAiServer(req);
}

function truncate(text: string): string {
  if (text.length <= MAX_CONTENT_CHARS) return text;
  return text.slice(0, MAX_CONTENT_CHARS) + "\n\n[Content truncated for processing]";
}

export async function generateSummary(
  content: string,
  language: Language,
): Promise<string> {
  const langMap: Record<Language, string> = {
    ko: "Korean",
    en: "English",
    ja: "Japanese",
    zh: "Chinese",
  };

  const result = await callAi({
    system: `You are a summarization assistant. Write a concise summary (3-5 sentences) of the provided content in ${langMap[language]}. Focus on the key points, main arguments, and important details. Output only the summary text, no preamble.`,
    message: truncate(content),
  });

  return result.trim();
}

export async function extractEntities(
  content: string,
  language: Language,
): Promise<ExtractedEntity[]> {
  const langMap: Record<Language, string> = {
    ko: "Korean",
    en: "English",
    ja: "Japanese",
    zh: "Chinese",
  };

  const result = await callAi({
    system: `You are an entity extraction assistant. Extract named entities from the content.
The content is in ${langMap[language]}.
Return a JSON array of objects with these fields:
- "name": the entity text (in original language)
- "type": one of "person", "organization", "location", "concept", "keyword", "date"
- "confidence": a number between 0.0 and 1.0

Extract up to 20 most relevant entities. Output ONLY the JSON array, no markdown fences or explanation.`,
    message: truncate(content),
  });

  try {
    // Strip markdown code fences if present
    const cleaned = result.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (e: { name?: string; type?: string; confidence?: number }) =>
          e.name && e.type && typeof e.confidence === "number",
      )
      .slice(0, 20)
      .map((e: { name: string; type: string; confidence: number }) => ({
        name: e.name,
        type: e.type as EntityType,
        confidence: Math.max(0, Math.min(1, e.confidence)),
      }));
  } catch {
    console.error("[ai-processor] Failed to parse entity extraction response:", result);
    return [];
  }
}

export interface StructuredMetadata {
  summary: string;
  what_it_solves: string;
  key_points: string[];
  tags: string[];
  reading_time_minutes: number;
}

export async function generateStructuredMetadata(
  content: string,
  language: Language,
  wordCount: number,
): Promise<StructuredMetadata> {
  const langMap: Record<Language, string> = {
    ko: "Korean", en: "English", ja: "Japanese", zh: "Chinese",
  };

  const result = await callAi({
    system: `You are a knowledge extraction assistant. Analyze the provided content and return a JSON object with these fields:
- "summary": 2-3 sentence summary in ${langMap[language]}
- "what_it_solves": 1-2 sentences describing what problem/question this content addresses, in ${langMap[language]}
- "key_points": array of 3-7 key bullet points (strings) in ${langMap[language]}
- "tags": array of 3-10 lowercase tags/keywords (in English, even for non-English content)
- "reading_time_minutes": estimated reading time as integer

Output ONLY the JSON object, no markdown fences or explanation.`,
    message: truncate(content),
  });

  try {
    const cleaned = result.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);

    // Calculate reading time fallback (200 WPM average)
    const fallbackTime = Math.max(1, Math.round(wordCount / 200));

    return {
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      what_it_solves: typeof parsed.what_it_solves === "string" ? parsed.what_it_solves : "",
      key_points: Array.isArray(parsed.key_points)
        ? parsed.key_points.filter((k: unknown): k is string => typeof k === "string").slice(0, 7)
        : [],
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((t: unknown): t is string => typeof t === "string").slice(0, 10)
        : [],
      reading_time_minutes: typeof parsed.reading_time_minutes === "number"
        ? Math.max(1, Math.round(parsed.reading_time_minutes))
        : fallbackTime,
    };
  } catch {
    console.error("[ai-processor] Failed to parse structured metadata:", result);
    return {
      summary: "",
      what_it_solves: "",
      key_points: [],
      tags: [],
      reading_time_minutes: Math.max(1, Math.round(wordCount / 200)),
    };
  }
}

export async function suggestCategories(
  content: string,
  userId: string,
  existingCategories: Array<{ id: string; name: string }>,
): Promise<CategorySuggestion[]> {
  const categoryList = existingCategories.length > 0
    ? existingCategories.map((c) => `- ${c.name} (id: ${c.id})`).join("\n")
    : "(No existing categories)";

  const result = await callAi({
    system: `You are a categorization assistant. Given the content and the user's existing categories, suggest up to 3 categories this content should be assigned to.

Existing categories:
${categoryList}

If existing categories match, use their IDs. If a new category is needed, use "new" as the categoryId and suggest a name.

Return a JSON array of objects with:
- "categoryId": existing category ID or "new"
- "categoryName": the category name
- "reason": brief explanation
- "confidence": number 0.0 to 1.0

Output ONLY the JSON array.`,
    message: truncate(content),
  });

  try {
    const cleaned = result.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (s: { categoryName?: string; confidence?: number }) =>
          s.categoryName && typeof s.confidence === "number",
      )
      .slice(0, 3)
      .map(
        (s: {
          categoryId: string;
          categoryName: string;
          reason: string;
          confidence: number;
        }) => ({
          categoryId: s.categoryId ?? "new",
          categoryName: s.categoryName,
          reason: s.reason ?? "",
          confidence: Math.max(0, Math.min(1, s.confidence)),
        }),
      );
  } catch {
    console.error("[ai-processor] Failed to parse category suggestion response:", result);
    return [];
  }
}
