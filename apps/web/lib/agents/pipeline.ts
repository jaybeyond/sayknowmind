/**
 * Agentic chat pipeline: search → generate.
 * Stage 1: MiniLM embedding → vector search (fast, no LLM)
 * Stage 2: LLM generates answer from retrieved context
 * All stages emit SSE events through StreamWriter.
 */

import { ollamaStreamChat } from "./ollama";
import { StreamWriter, type StreamSource } from "./stream-writer";
import { queryEdgeQuake } from "@/lib/edgequake/client";
import { pool } from "@/lib/db";

interface PipelineInput {
  message: string;
  conversationId: string;
  userId: string;
  history: { role: string; content: string }[];
  writer: StreamWriter;
}

// ── Intent Detection (no LLM — fast regex) ────────────────────

const GREETING_PATTERNS =
  /^(hi|hello|hey|yo|sup|안녕|こんにちは|你好|thanks|thank you|감사|ありがとう|고마워|잘|좋아|ㅎㅎ|ㅋㅋ|ok|okay|네|응|ㅇㅇ)\s*[.!?~]*$/i;

const CONVERSATIONAL_PATTERNS = [
  /^(뭐|뭘|어떻게|왜|어디|누가|언제)\s/,    // Korean question words
  /느린|빠른|좋은|나쁜|이상한/,               // Korean adjectives (opinions)
  /같아|것 같|거 같|듯|보여/,                 // Korean speculation endings
  /해줘|해봐|알려|설명|도와/,                 // Korean request endings
  /^(what|how|why|can you|tell me|explain)/i, // English questions
];

function needsSearch(message: string): boolean {
  const trimmed = message.trim();

  // Pure greetings — no search
  if (GREETING_PATTERNS.test(trimmed)) return false;

  // Short conversational messages — no search
  if (trimmed.length < 5) return false;

  // Explicit search intent
  if (/검색|찾아|search|find|look for|알려줘.*에 대해/i.test(trimmed)) return true;

  // Conversational patterns — skip search, let LLM answer from context
  for (const pattern of CONVERSATIONAL_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }

  // Default: search if message is long enough to be a real question
  return trimmed.length >= 8;
}

// ── Stage 1: Search Knowledge Base (MiniLM vector search) ────

async function searchKnowledge(
  message: string,
  userId: string,
  writer: StreamWriter,
): Promise<{ sources: StreamSource[]; contextText: string }> {
  if (!needsSearch(message)) {
    writer.status("thinking", "Processing...");
    writer.log("Conversational query — skipping knowledge base search");
    return { sources: [], contextText: "" };
  }

  writer.status("searching", "Searching your knowledge base...");
  writer.log(`Query: "${message}"`);

  const allSources: StreamSource[] = [];
  const seenIds = new Set<string>();

  // EdgeQuake vector search (naive mode = pure embedding, no LLM keyword extraction)
  try {
    const result = await queryEdgeQuake({
      query: message,
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
      const keywords = message
        .split(/\s+/)
        .filter((w) => w.length >= 2)
        .slice(0, 10);

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

  // Final fallback: recent documents
  if (allSources.length === 0) {
    writer.log("Loading recent documents...");
    try {
      const recentResult = await pool.query(
        `SELECT id, title, url, LEFT(content, 500) as excerpt
         FROM documents
         WHERE user_id = $1
         ORDER BY updated_at DESC
         LIMIT 5`,
        [userId],
      );

      writer.log(`Found ${recentResult.rowCount ?? 0} recent documents`);

      for (const row of recentResult.rows) {
        allSources.push({
          id: row.id,
          title: row.title,
          url: row.url ?? undefined,
          excerpt: row.excerpt ?? "",
          score: 0.5,
        });
      }
    } catch (err) {
      writer.log(`Failed to load recent documents: ${(err as Error).message}`);
    }
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

  return { sources: topSources, contextText };
}

// ── Stage 2: Generate Answer (LLM) ──────────────────────────

async function generateAnswer(
  message: string,
  history: { role: string; content: string }[],
  contextText: string,
  userId: string,
  writer: StreamWriter,
): Promise<string> {
  writer.status("answering", "Generating answer...");

  // Get user's knowledge base stats
  let docCount = 0;
  let docTitles: string[] = [];
  try {
    const statsResult = await pool.query(
      `SELECT COUNT(*) as count FROM documents WHERE user_id = $1`,
      [userId],
    );
    docCount = parseInt(statsResult.rows[0]?.count ?? "0", 10);

    const titlesResult = await pool.query(
      `SELECT title FROM documents WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 20`,
      [userId],
    );
    docTitles = titlesResult.rows.map((r: { title: string }) => r.title);
  } catch {
    // stats not critical
  }

  if (contextText) {
    writer.log(`Answering with ${contextText.split("[").length - 1} sources`);
  } else {
    writer.log("Answering from general knowledge");
  }

  const docList = docTitles.length > 0
    ? docTitles.map((t, i) => `${i + 1}. ${t}`).join("\n")
    : "empty";

  // System prompt with intent guidance (pattern from pi-mono)
  let systemPromptText = `You are SayKnowMind, a personal knowledge assistant.
You manage the user's saved documents and help them find information.
You CAN access their data. NEVER say you cannot.

The user has ${docCount} saved documents:
${docList}

IMPORTANT GUIDELINES:
- Respond in the SAME language as the user's question.
- For casual/conversational messages, respond naturally and briefly.
- When citing documents, use [1], [2] format.
- Be concise and helpful. Don't repeat the question back.
- If asked about performance or speed, that's about the app — answer honestly.`;

  if (contextText) {
    systemPromptText += `\n\nRelevant documents:\n${contextText}\n\nCite these sources as [1], [2] etc. when using information from them.`;
  }

  const messages = [
    ...history.slice(-8).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: message },
  ];

  writer.log("Streaming response from LLM...");

  // Parse qwen3 thinking: /v1 returns reasoning_content separately,
  // ollama.ts wraps it in <think> tags for us to route to logs
  let insideThink = false;
  let thinkBuffer = "";
  let answerText = "";

  const fullAnswer = await ollamaStreamChat(
    systemPromptText,
    messages,
    (token) => {
      let remaining = token;

      while (remaining.length > 0) {
        if (insideThink) {
          const closeIdx = remaining.indexOf("</think>");
          if (closeIdx !== -1) {
            thinkBuffer += remaining.slice(0, closeIdx);
            if (thinkBuffer.trim()) {
              writer.log(thinkBuffer.trim());
            }
            thinkBuffer = "";
            insideThink = false;
            remaining = remaining.slice(closeIdx + 8);
          } else {
            thinkBuffer += remaining;
            const lines = thinkBuffer.split("\n");
            thinkBuffer = lines.pop() ?? "";
            for (const line of lines) {
              if (line.trim()) writer.log(line.trim());
            }
            remaining = "";
          }
        } else {
          const openIdx = remaining.indexOf("<think>");
          if (openIdx !== -1) {
            const before = remaining.slice(0, openIdx);
            if (before) {
              answerText += before;
              writer.token(before);
            }
            insideThink = true;
            remaining = remaining.slice(openIdx + 7);
          } else {
            answerText += remaining;
            writer.token(remaining);
            remaining = "";
          }
        }
      }
    },
  );

  if (thinkBuffer.trim()) {
    writer.log(thinkBuffer.trim());
  }

  return answerText || fullAnswer;
}

// ── Main Pipeline ───────────────────────────────────────────────

export async function runPipeline(input: PipelineInput): Promise<void> {
  const { message, conversationId, userId, history, writer } = input;

  try {
    // Stage 1: Vector search (MiniLM embedding, no LLM)
    const { contextText } = await searchKnowledge(message, userId, writer);

    // Stage 2: LLM generates answer
    const answer = await generateAnswer(message, history, contextText, userId, writer);

    // Store assistant message
    let messageId = "";
    try {
      const insertResult = await pool.query(
        `INSERT INTO messages (conversation_id, role, content)
         VALUES ($1, 'assistant', $2)
         RETURNING id`,
        [conversationId, answer],
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
