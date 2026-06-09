/**
 * In-process document creation and sharing for the chat pipeline.
 *
 * Content builders are ported from packages/mcp-server/src/tools/sayknowmind.ts
 * so the pipeline can create fully-populated docs/sheets/mindmaps without
 * going through an HTTP round-trip.  The metadata structures written here
 * are the EXACT shapes the editor reads back (doc-tabs / mindmap-editor).
 */

import { insertDocument } from "@/lib/ingest/document-store";
import { shareDocument } from "@/lib/shared-mode";
import type { ShareOptions } from "@/lib/shared-mode";
import { pool } from "@/lib/db";

// ── Primitive types ───────────────────────────────────────────────

export type CellValue = string | number | boolean | null;

type SimpleBlock = {
  type: string;
  content?: string;
  props?: Record<string, unknown>;
};

export interface MindInput {
  topic: string;
  children?: MindInput[];
}

interface MindNode {
  id: string;
  topic: string;
  children?: MindNode[];
}

// ── Rich-content builders (ported from mcp-server) ───────────────

/** Minimal Markdown → BlockNote partial blocks (headings, lists, code, quotes, paragraphs). */
export function markdownToBlocks(md: string): SimpleBlock[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: SimpleBlock[] = [];
  let inCode = false;
  let codeBuf: string[] = [];

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) {
        blocks.push({ type: "codeBlock", content: codeBuf.join("\n") });
        codeBuf = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    const t = line.trim();
    if (t === "") continue;

    const h = t.match(/^(#{1,3})\s+(.*)$/);
    if (h) { blocks.push({ type: "heading", props: { level: h[1].length }, content: h[2] }); continue; }

    const bullet = t.match(/^[-*]\s+(.*)$/);
    if (bullet) { blocks.push({ type: "bulletListItem", content: bullet[1] }); continue; }

    const num = t.match(/^\d+\.\s+(.*)$/);
    if (num) { blocks.push({ type: "numberedListItem", content: num[1] }); continue; }

    const quote = t.match(/^>\s+(.*)$/);
    if (quote) { blocks.push({ type: "quote", content: quote[1] }); continue; }

    blocks.push({ type: "paragraph", content: t });
  }

  if (inCode && codeBuf.length) blocks.push({ type: "codeBlock", content: codeBuf.join("\n") });
  return blocks.length ? blocks : [{ type: "paragraph", content: "" }];
}

export function blocksToPlaintext(blocks: SimpleBlock[]): string {
  return blocks
    .map((b) => b.content ?? "")
    .filter(Boolean)
    .join("\n");
}

/** 2D rows → minimal Univer IWorkbookData snapshot (cellData keyed [row][col].v). */
export function rowsToWorkbook(
  rows: CellValue[][],
  sheetName: string,
  title: string,
): Record<string, unknown> {
  const sheetId = "sheet-1";
  const cellData: Record<string, Record<string, { v: CellValue }>> = {};
  let maxCol = 0;

  rows.forEach((row, r) => {
    const colObj: Record<string, { v: CellValue }> = {};
    row.forEach((val, c) => {
      if (val === null || val === undefined || val === "") return;
      colObj[String(c)] = { v: val };
      if (c + 1 > maxCol) maxCol = c + 1;
    });
    if (Object.keys(colObj).length) cellData[String(r)] = colObj;
  });

  return {
    id: crypto.randomUUID(),
    name: title || sheetName || "Sheet",
    sheetOrder: [sheetId],
    styles: {},
    sheets: {
      [sheetId]: {
        id: sheetId,
        name: sheetName || "Sheet1",
        cellData,
        rowCount: Math.max(rows.length + 20, 100),
        columnCount: Math.max(maxCol + 6, 26),
      },
    },
  };
}

export function rowsToPlaintext(rows: CellValue[][]): string {
  return rows
    .map((r) => r.map((c) => (c == null ? "" : String(c))).join("\t"))
    .join("\n");
}

/** Nested {topic,children} → mind-elixir nodeData (root id fixed to "root"). */
export function treeToMindmap(
  tree: MindInput | undefined,
  title: string,
): { nodeData: MindNode } {
  const build = (node: MindInput): MindNode => ({
    id: crypto.randomUUID(),
    topic: node.topic,
    children: (node.children ?? []).map(build),
  });

  if (!tree) return { nodeData: { id: "root", topic: title || "Mind map" } };
  const root = build(tree);
  root.id = "root";
  return { nodeData: root };
}

function mindTopics(node: MindNode): string[] {
  return [node.topic, ...(node.children ?? []).flatMap(mindTopics)];
}

// ── Public API ───────────────────────────────────────────────────

export interface CreateDocumentParams {
  userId: string;
  organizationId: string;
  type: "doc" | "sheet" | "mindmap";
  title: string;
  markdown?: string;
  rows?: CellValue[][];
  sheetName?: string;
  mindmap?: MindInput;
}

export interface CreateDocumentResult {
  id: string;
  /** App-relative URL: /docs/<id> or /mindmaps/<id> */
  url: string;
}

/**
 * Create a fully-populated editor document in-process as the authenticated user.
 * Mirrors the POST /api/docs + PATCH /api/documents/<id> sequence the MCP tool uses,
 * but without HTTP — writes directly to the DB via insertDocument.
 */
export async function createEditorDocument(
  params: CreateDocumentParams,
): Promise<CreateDocumentResult> {
  const { userId, organizationId, type } = params;
  const title = params.title.trim() || "Untitled";

  let id: string;

  if (type === "mindmap") {
    const mindmapData = treeToMindmap(params.mindmap, title);
    const contentText = mindTopics(mindmapData.nodeData).join("\n");
    id = await insertDocument({
      userId,
      organizationId,
      title,
      content: contentText,
      sourceType: "mindmap",
      metadata: { content_format: "mindmap", mindmap: mindmapData },
    });
  } else if (type === "sheet") {
    const rows = params.rows ?? [];
    const sheetName = params.sheetName || title;
    const tabId = crypto.randomUUID();
    const snap = rows.length > 0 ? rowsToWorkbook(rows, sheetName, title) : null;
    id = await insertDocument({
      userId,
      organizationId,
      title,
      content: rows.length > 0 ? rowsToPlaintext(rows) : "",
      sourceType: "sheet",
      metadata: {
        content_format: "blocknote",
        docTabs: {
          tabs: [{ id: tabId, name: sheetName, kind: "sheet" }],
          blocks: {},
          univer: { [tabId]: snap },
        },
      },
    });
  } else {
    // doc
    const blocks = params.markdown
      ? markdownToBlocks(params.markdown)
      : [{ type: "paragraph", content: "" }];
    const tabId = crypto.randomUUID();
    id = await insertDocument({
      userId,
      organizationId,
      title,
      content: params.markdown ? blocksToPlaintext(blocks) : "",
      sourceType: "doc",
      metadata: {
        content_format: "blocknote",
        docTabs: {
          tabs: [{ id: tabId, name: title, kind: "blocknote" }],
          blocks: { [tabId]: blocks },
          univer: {},
        },
      },
    });
  }

  const path = type === "mindmap" ? "mindmaps" : "docs";
  return { id, url: `/${path}/${id}` };
}

// ── Share ────────────────────────────────────────────────────────

export interface ShareDocumentParams {
  documentId: string;
  userId: string;
  accessType?: "public" | "passphrase";
  passphrase?: string;
  expiryHours?: number;
}

export interface ShareDocumentResult {
  shareToken: string;
  /** App-relative URL: /s/<shareToken> */
  url: string;
}

/**
 * Share an editor document in-process as the authenticated user.
 * Replicates the POST /api/share logic without an HTTP round-trip.
 * Only the document owner can call this (user_id = userId check in the query).
 */
export async function shareEditorDocument(
  params: ShareDocumentParams,
): Promise<ShareDocumentResult> {
  const {
    documentId,
    userId,
    accessType = "public",
    passphrase,
    expiryHours = 0,
  } = params;

  const docResult = await pool.query(
    `SELECT d.id, d.content, d.title, d.summary, d.url, d.source_type, d.metadata, d.privacy_level,
            (SELECT c.privacy_level FROM categories c
             JOIN document_categories dc ON dc.category_id = c.id
             WHERE dc.document_id = d.id LIMIT 1) as category_privacy
     FROM documents d WHERE d.id = $1 AND d.user_id = $2`,
    [documentId, userId],
  );

  if (docResult.rows.length === 0) {
    throw new Error(`Document ${documentId} not found or not owned by user`);
  }

  const doc = docResult.rows[0] as {
    content: string;
    title: string;
    summary: string | null;
    url: string | null;
    source_type: string;
    metadata: Record<string, unknown> | null;
    privacy_level: string;
    category_privacy: string | null;
  };
  const meta = (doc.metadata ?? {}) as Record<string, unknown>;
  const includeRawContent = doc.source_type === "text" || doc.source_type === "file";
  const isTabbed = doc.source_type === "doc" || doc.source_type === "sheet";

  const shareContent = JSON.stringify({
    title: doc.title,
    summary: doc.summary,
    content: includeRawContent ? doc.content : undefined,
    url: doc.url,
    sourceType: doc.source_type,
    contentFormat: typeof meta.content_format === "string" ? meta.content_format : undefined,
    docTabs:
      isTabbed && meta.docTabs && typeof meta.docTabs === "object"
        ? meta.docTabs
        : undefined,
    mindmap:
      doc.source_type === "mindmap" && meta.mindmap && typeof meta.mindmap === "object"
        ? meta.mindmap
        : undefined,
    ogImage: typeof meta.ogImage === "string" ? meta.ogImage : undefined,
    aiSummary: typeof meta.summary === "string" ? meta.summary : undefined,
    whatItSolves: typeof meta.what_it_solves === "string" ? meta.what_it_solves : undefined,
    keyPoints: Array.isArray(meta.key_points) ? meta.key_points : undefined,
    readingTimeMinutes:
      typeof meta.reading_time_minutes === "number" ? meta.reading_time_minutes : undefined,
    tags: [
      ...new Set(
        [
          ...(Array.isArray(meta.aiTags) ? meta.aiTags : []),
          ...(Array.isArray(meta.userTags) ? meta.userTags : []),
          ...(Array.isArray(meta.tags) ? meta.tags : []),
        ].filter((t): t is string => typeof t === "string"),
      ),
    ],
  });

  const options: ShareOptions = { accessType, passphrase, expiryHours };

  const result = await shareDocument(
    documentId,
    shareContent,
    userId,
    options,
    doc.privacy_level as "private" | "shared" | undefined,
    doc.category_privacy as "private" | "shared" | undefined,
  );

  return { shareToken: result.shareToken, url: `/s/${result.shareToken}` };
}
