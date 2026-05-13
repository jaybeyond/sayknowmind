/**
 * Client-side bridge to local LLM providers via Tauri.
 *
 * The lite-desktop webview loads a cloud-hosted Next.js but the user's
 * Claude Pro/Max subscription (OCP) and ChatGPT subscription (Codex) only
 * answer on their own machine. Both are routed through this bridge so
 * non-chat LLM work (summary, entities, categories) can use them for $0
 * instead of falling all the way through to a paid cloud provider.
 *
 * Mirrors the chat fast-path in `chat-page.tsx`: detect Tauri, query the
 * appropriate status command, invoke a one-shot completion, then persist
 * results back to the cloud via `apply-summary`.
 */

type TauriInvoke = <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

interface TauriBridge {
  invoke?: TauriInvoke;
}

function bridge(): TauriBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { __TAURI_INTERNALS__?: TauriBridge }).__TAURI_INTERNALS__ ?? null;
}

/** True only when we're inside Tauri AND OCP responds healthy. */
export async function isOcpBridgeReady(): Promise<boolean> {
  const b = bridge();
  if (!b?.invoke) return false;
  try {
    const status = await b.invoke<{ ready?: boolean }>("ocp_status");
    return Boolean(status?.ready);
  } catch {
    return false;
  }
}

/** True only when we're inside Tauri AND Codex's auth file exists. */
export async function isCodexBridgeReady(): Promise<boolean> {
  const b = bridge();
  if (!b?.invoke) return false;
  try {
    const status = await b.invoke<{ ready?: boolean }>("codex_status");
    return Boolean(status?.ready);
  } catch {
    return false;
  }
}

type Locale = "ko" | "en" | "ja" | "zh";
const LANG_NAME: Record<Locale, string> = {
  ko: "Korean",
  en: "English",
  ja: "Japanese",
  zh: "Chinese",
};

function asLocale(s: string | undefined | null): Locale {
  return s === "ko" || s === "ja" || s === "zh" ? s : "en";
}

const MAX_CONTENT_CHARS = 8000;
function truncate(text: string): string {
  if (text.length <= MAX_CONTENT_CHARS) return text;
  return text.slice(0, MAX_CONTENT_CHARS) + "\n\n[Content truncated for processing]";
}

/**
 * Build the same structured-metadata prompt the cloud job-queue uses, so
 * downstream consumers (search snippets, share view, etc.) get fields in
 * the expected shape no matter which path summarized the document.
 */
function buildSystemPrompt(language: Locale): string {
  const lang = LANG_NAME[language];
  return `You are a knowledge extraction assistant. Analyze the provided content and return a JSON object with these fields:
- "title": a concise, descriptive title (1 line, max 80 chars) — MUST be written in ${lang}
- "summary": 2-3 sentence summary — MUST be written in ${lang}
- "what_it_solves": 1-2 sentences describing what problem/question this content addresses — MUST be written in ${lang}
- "key_points": array of 3-7 key bullet points (strings) — MUST be written in ${lang}
- "tags": array of 3-5 highly specific, descriptive tags — MUST be specific and descriptive, written in ${lang}. Avoid generic tags like "technology", "information", "article".
- "reading_time_minutes": estimated reading time as integer

IMPORTANT: ALL text output MUST be in ${lang}. Even if the content is in another language, your output must be in ${lang}.

Output ONLY the JSON object, no markdown fences or explanation.`;
}

interface StructuredMetadataPayload {
  title?: string;
  summary?: string;
  what_it_solves?: string;
  key_points?: string[];
  tags?: string[];
  reading_time_minutes?: number;
  language: Locale;
}

function parseModelJson(raw: string): Record<string, unknown> | null {
  // Strip markdown fences first, then try to JSON.parse. If that fails,
  // try to locate the first {...} block — Codex sometimes prepends or
  // appends prose to the JSON body when it doesn't take instructions
  // literally enough.
  const cleaned = raw.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
  const attempts: string[] = [cleaned];
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    attempts.push(cleaned.slice(firstBrace, lastBrace + 1));
  }
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

function normalizePayload(
  parsed: Record<string, unknown>,
  docLanguage: Locale,
): StructuredMetadataPayload {
  return {
    title: typeof parsed.title === "string" ? parsed.title.slice(0, 120) : undefined,
    summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
    what_it_solves: typeof parsed.what_it_solves === "string" ? parsed.what_it_solves : undefined,
    key_points: Array.isArray(parsed.key_points)
      ? (parsed.key_points as unknown[]).filter((k): k is string => typeof k === "string").slice(0, 7)
      : undefined,
    tags: Array.isArray(parsed.tags)
      ? (parsed.tags as unknown[]).filter((t): t is string => typeof t === "string").slice(0, 5)
      : undefined,
    reading_time_minutes:
      typeof parsed.reading_time_minutes === "number"
        ? Math.max(1, Math.round(parsed.reading_time_minutes))
        : undefined,
    language: docLanguage,
  };
}

interface DocFetchResult {
  content: string;
  language: Locale;
}

async function fetchDocForSummary(
  documentId: string,
  localeHint: string | undefined,
): Promise<DocFetchResult | null> {
  try {
    const res = await fetch(`/api/documents/${documentId}`);
    if (!res.ok) return null;
    const doc = await res.json();
    const content = typeof doc.content === "string" ? doc.content : "";
    if (!content || content.trim().length === 0) return null;
    const metaLang =
      doc?.metadata && typeof doc.metadata === "object" && doc.metadata
        ? (doc.metadata as { language?: string }).language
        : undefined;
    const language = metaLang ? asLocale(metaLang) : asLocale(localeHint);
    return { content, language };
  } catch {
    return null;
  }
}

async function applySummary(
  documentId: string,
  payload: StructuredMetadataPayload,
): Promise<boolean> {
  if (!payload.summary || payload.summary.trim().length === 0) return false;
  try {
    const applyRes = await fetch(`/api/documents/${documentId}/apply-summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!applyRes.ok) {
      console.warn(`[local-llm] apply-summary returned ${applyRes.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn("[local-llm] apply-summary network error:", err);
    return false;
  }
}

async function runCompletion(
  cmd: "complete_via_ocp" | "complete_via_codex",
  system: string,
  user: string,
): Promise<string | null> {
  const b = bridge();
  if (!b?.invoke) return null;
  try {
    const reply = await b.invoke<{ content: string; model: string }>(cmd, {
      system,
      user,
      model: null,
    });
    return reply?.content ?? null;
  } catch (err) {
    console.warn(`[local-llm] ${cmd} failed:`, err);
    return null;
  }
}

async function summarizeDocViaCommand(
  cmd: "complete_via_ocp" | "complete_via_codex",
  documentId: string,
  localeHint?: string,
): Promise<boolean> {
  const doc = await fetchDocForSummary(documentId, localeHint);
  if (!doc) return false;
  const raw = await runCompletion(cmd, buildSystemPrompt(doc.language), truncate(doc.content));
  if (!raw) return false;
  const parsed = parseModelJson(raw);
  if (!parsed) {
    console.warn(`[local-llm] ${cmd} response was not JSON:`, raw.slice(0, 200));
    return false;
  }
  return applySummary(documentId, normalizePayload(parsed, doc.language));
}

/** Summarize via OCP only. Returns false unless OCP is reachable. */
export async function summarizeDocViaOcp(
  documentId: string,
  localeHint?: string,
): Promise<boolean> {
  if (!(await isOcpBridgeReady())) return false;
  return summarizeDocViaCommand("complete_via_ocp", documentId, localeHint);
}

/** Summarize via Codex only. Returns false unless Codex is reachable. */
export async function summarizeDocViaCodex(
  documentId: string,
  localeHint?: string,
): Promise<boolean> {
  if (!(await isCodexBridgeReady())) return false;
  return summarizeDocViaCommand("complete_via_codex", documentId, localeHint);
}

/**
 * Summarize through whichever local LLM is available. Tries OCP first
 * (cheapest + fastest local proxy), falls back to Codex CLI if OCP isn't
 * ready, and returns false if neither path produced a usable summary.
 * The cloud job-queue is still racing in parallel as the last resort.
 */
export async function summarizeDocLocally(
  documentId: string,
  localeHint?: string,
): Promise<boolean> {
  if (await isOcpBridgeReady()) {
    if (await summarizeDocViaCommand("complete_via_ocp", documentId, localeHint)) {
      return true;
    }
  }
  if (await isCodexBridgeReady()) {
    if (await summarizeDocViaCommand("complete_via_codex", documentId, localeHint)) {
      return true;
    }
  }
  return false;
}
