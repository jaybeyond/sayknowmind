import type { EntityType, Language, CategorySuggestion } from "@/lib/types";
import { callAiCloudFirst } from "@/lib/agents/cloud-ai";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const AI_TIMEOUT = 60_000;
const MAX_CONTENT_CHARS = 8000;

interface CustomPrompts {
  summary: string;
  whatItSolves: string;
  keyPoints: string;
  tags: string;
}

const DEFAULT_PROMPTS: CustomPrompts = {
  summary: "2-3 sentence summary",
  whatItSolves: "1-2 sentences describing what problem/question this content addresses",
  keyPoints: "array of 3-7 key bullet points",
  tags: "array of 3-5 highly specific, descriptive tags (not generic words like 'technology' or 'software' — use precise terms like 'react-server-components' or 'vector-database')",
};

function getCustomPrompts(): CustomPrompts {
  try {
    const fp = join(process.cwd(), ".sayknowmind-prompts.json");
    if (existsSync(fp)) {
      const data = JSON.parse(readFileSync(fp, "utf-8"));
      return { ...DEFAULT_PROMPTS, ...data };
    }
  } catch { /* ignore */ }
  return DEFAULT_PROMPTS;
}

interface AiChatRequest {
  system: string;
  message: string;
  images?: string[]; // base64-encoded images for vision models
}

interface ExtractedEntity {
  name: string;
  type: EntityType;
  confidence: number;
}

/**
 * AI call priority (for ALL requests including vision):
 * 1. Cloud providers (from .sayknowmind-providers.json — OpenRouter, etc.)
 * 2. Ollama fallback ONLY on 400/402/429
 */
async function callAi(req: AiChatRequest): Promise<string> {
  return await callAiCloudFirst({
    system: req.system,
    message: req.message,
    images: req.images,
    timeout: req.images?.length ? 120_000 : AI_TIMEOUT,
  });
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
  title: string;
  summary: string;
  what_it_solves: string;
  key_points: string[];
  aiTags: string[];
  reading_time_minutes: number;
}

export async function generateStructuredMetadata(
  content: string,
  language: Language,
  wordCount: number,
  existingTags: string[] = [],
): Promise<StructuredMetadata> {
  const langMap: Record<Language, string> = {
    ko: "Korean", en: "English", ja: "Japanese", zh: "Chinese",
  };

  const prompts = getCustomPrompts();

  const result = await callAi({
    system: `You are a knowledge extraction assistant. Analyze the provided content and return a JSON object with these fields:
- "title": a concise, descriptive title (1 line, max 80 chars) — MUST be written in ${langMap[language]}
- "summary": ${prompts.summary} — MUST be written in ${langMap[language]}
- "what_it_solves": ${prompts.whatItSolves} — MUST be written in ${langMap[language]}
- "key_points": ${prompts.keyPoints} (strings) — MUST be written in ${langMap[language]}
- "tags": ${prompts.tags} — MUST be specific and descriptive, written in ${langMap[language]}. Avoid generic tags like "technology", "information", "article".
- "reading_time_minutes": estimated reading time as integer

TAG RULES:
- REUSE existing tags when relevant. Prefer exact matches from the list below.
- Do NOT create variations of existing tags (e.g. if "react" exists, don't create "reactjs" or "React").
- Only create a new tag if no existing tag is relevant.
${existingTags.length > 0 ? `\nExisting tags (REUSE these when applicable):\n${existingTags.join(", ")}` : ""}

IMPORTANT: ALL text output MUST be in ${langMap[language]}. Even if the content is in another language, your output must be in ${langMap[language]}.

Output ONLY the JSON object, no markdown fences or explanation.`,
    message: truncate(content),
  });

  try {
    const cleaned = result.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);

    // Calculate reading time fallback (200 WPM average)
    const fallbackTime = Math.max(1, Math.round(wordCount / 200));

    return {
      title: typeof parsed.title === "string" ? parsed.title.slice(0, 120) : "",
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      what_it_solves: typeof parsed.what_it_solves === "string" ? parsed.what_it_solves : "",
      key_points: Array.isArray(parsed.key_points)
        ? parsed.key_points.filter((k: unknown): k is string => typeof k === "string").slice(0, 7)
        : [],
      aiTags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((t: unknown): t is string => typeof t === "string").slice(0, 5)
        : [],
      reading_time_minutes: typeof parsed.reading_time_minutes === "number"
        ? Math.max(1, Math.round(parsed.reading_time_minutes))
        : fallbackTime,
    };
  } catch {
    console.error("[ai-processor] Failed to parse structured metadata:", result);
    return {
      title: "",
      summary: "",
      what_it_solves: "",
      key_points: [],
      aiTags: [],
      reading_time_minutes: Math.max(1, Math.round(wordCount / 200)),
    };
  }
}

export async function suggestCategories(
  content: string,
  userId: string,
  existingCategories: Array<{ id: string; name: string }>,
  language: Language = "en",
): Promise<CategorySuggestion[]> {
  const langMap: Record<Language, string> = {
    ko: "Korean", en: "English", ja: "Japanese", zh: "Chinese",
  };

  const categoryList = existingCategories.length > 0
    ? existingCategories.map((c) => `- ${c.name} (id: ${c.id})`).join("\n")
    : "(No existing categories)";

  const result = await callAi({
    system: `You are a strict categorization assistant. Given the content and the user's existing categories, suggest exactly 1 category this content should be assigned to.

STRICT RULES:
1. You MUST use an existing category if there is even a 30% relevance match. Be very generous with matching.
2. NEVER create a new category if there are fewer than 5 existing categories — force-fit into the best existing one.
3. Only suggest "new" if: the user has 5+ categories AND the content is completely unrelated to ALL existing ones.
4. New category names must be broad, reusable topic areas (e.g. "AI", "개발", "디자인") — never specific article titles.
5. Do NOT create categories that are synonyms or subsets of existing ones (e.g. if "AI" exists, don't create "인공지능" or "머신러닝").
6. Suggest at most 1 category total. Do NOT suggest 2 or more.
7. Category names must be in ${langMap[language]}.

Existing categories:
${categoryList}

Return a JSON array of objects with:
- "categoryId": existing category ID or "new"
- "categoryName": the category name (in ${langMap[language]})
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

/**
 * Describe an image using a vision model (OCR + understanding).
 * Returns extracted text content and a suggested title.
 */
export async function describeImage(
  base64Image: string,
  language: Language = "en",
): Promise<{ title: string; content: string }> {
  const langMap: Record<Language, string> = {
    ko: "Korean", en: "English", ja: "Japanese", zh: "Chinese",
  };

  const result = await callAi({
    system: `You are an image analysis assistant. Analyze the image and provide:
1. A short descriptive title (1 line)
2. Full OCR text extraction (if any text is visible)
3. A detailed description of the image content

Respond in ${langMap[language]}.

Format your response as:
TITLE: <title>
---
<All extracted text from the image, then a description of the visual content>`,
    message: "Analyze this image. Extract all visible text (OCR) and describe the content.",
    images: [base64Image],
  });

  const titleMatch = result.match(/^TITLE:\s*(.+)/m);
  const title = titleMatch?.[1]?.trim() ?? "Image";
  const content = result
    .replace(/^TITLE:\s*.+\n/m, "")
    .replace(/^---\n?/m, "")
    .trim();

  return { title, content: content || result };
}

/**
 * Describe a video frame using a vision model.
 */
export async function describeVideoFrame(
  base64Frame: string,
  language: Language = "en",
): Promise<{ title: string; content: string }> {
  const langMap: Record<Language, string> = {
    ko: "Korean", en: "English", ja: "Japanese", zh: "Chinese",
  };

  const result = await callAi({
    system: `You are a video analysis assistant. This is a keyframe from a video. Describe:
1. A short title for this video
2. What is happening in this frame
3. Any text visible on screen (OCR)

Respond in ${langMap[language]}.

Format:
TITLE: <title>
---
<description and extracted text>`,
    message: "Describe this video frame.",
    images: [base64Frame],
  });

  const titleMatch = result.match(/^TITLE:\s*(.+)/m);
  const title = titleMatch?.[1]?.trim() ?? "Video";
  const content = result
    .replace(/^TITLE:\s*.+\n/m, "")
    .replace(/^---\n?/m, "")
    .trim();

  return { title, content: content || result };
}
