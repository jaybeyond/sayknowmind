import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { ErrorCode } from "@/lib/types";

// Lazy imports to avoid loading heavy modules upfront
async function getMammoth() {
  return await import("mammoth");
}

export interface ParsedContent {
  title: string;
  content: string;
  wordCount: number;
  fileType: string;
  metadata: {
    author?: string;
    language?: string;
    pageCount?: number;
    fileSize?: number;
  };
}

const SUPPORTED_MIME_TYPES: Record<string, string> = {
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/html": "html",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "image/png": "image",
  "image/jpeg": "image",
  "image/jpg": "image",
  "image/webp": "image",
  "image/gif": "image",
  "image/svg+xml": "image",
  "video/mp4": "video",
  "video/webm": "video",
  "video/quicktime": "video",
};

// Also match by file extension
const EXTENSION_MAP: Record<string, string> = {
  ".pdf": "pdf",
  ".txt": "txt",
  ".md": "md",
  ".markdown": "md",
  ".html": "html",
  ".htm": "html",
  ".docx": "docx",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".webp": "image",
  ".gif": "image",
  ".svg": "image",
  ".mp4": "video",
  ".webm": "video",
  ".mov": "video",
};

function detectFileType(mimeType: string, fileName: string): string {
  // Try MIME type first
  const fromMime = SUPPORTED_MIME_TYPES[mimeType];
  if (fromMime) return fromMime;

  // Fall back to file extension
  const ext = fileName.substring(fileName.lastIndexOf(".")).toLowerCase();
  const fromExt = EXTENSION_MAP[ext];
  if (fromExt) return fromExt;

  // application/octet-stream with known extension
  if (mimeType === "application/octet-stream") {
    const fallback = EXTENSION_MAP[ext];
    if (fallback) return fallback;
  }

  throw Object.assign(
    new Error(`Unsupported file format: ${mimeType} (${fileName})`),
    { code: ErrorCode.INGEST_UNSUPPORTED_FORMAT },
  );
}

function countWords(text: string): number {
  // Handle CJK characters as individual words + latin word boundaries
  const cjk = text.match(/[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g);
  const latin = text.match(/[a-zA-Z0-9]+/g);
  return (cjk?.length ?? 0) + (latin?.length ?? 0);
}

async function parsePdf(buffer: Buffer): Promise<ParsedContent> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const info = await parser.getInfo();
  const textResult = await parser.getText();
  const content = textResult.text.trim();
  await parser.destroy();
  return {
    title: info?.info?.Title || info?.info?.title || "",
    content,
    wordCount: countWords(content),
    fileType: "pdf",
    metadata: {
      author: info?.info?.Author || info?.info?.author,
      pageCount: info.total,
    },
  };
}

async function parseDocx(buffer: Buffer): Promise<ParsedContent> {
  const mammoth = await getMammoth();
  const result = await mammoth.extractRawText({ buffer });
  const content = result.value.trim();
  return {
    title: "",
    content,
    wordCount: countWords(content),
    fileType: "docx",
    metadata: {},
  };
}

function parseHtml(text: string): ParsedContent {
  const dom = new JSDOM(text, { url: "https://localhost" });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (article && article.textContent) {
    const content = article.textContent.trim();
    return {
      title: article.title || "",
      content,
      wordCount: countWords(content),
      fileType: "html",
      metadata: {
        author: article.byline || undefined,
      },
    };
  }

  // Fallback: extract text from body
  const body = dom.window.document.body?.textContent?.trim() ?? "";
  const title = dom.window.document.title ?? "";
  return {
    title,
    content: body,
    wordCount: countWords(body),
    fileType: "html",
    metadata: {},
  };
}

function parsePlainText(text: string, fileType: string): ParsedContent {
  const content = text.trim();
  // Try to extract title from first line for markdown
  let title = "";
  if (fileType === "md") {
    const firstLine = content.split("\n")[0];
    if (firstLine?.startsWith("# ")) {
      title = firstLine.slice(2).trim();
    }
  }
  return {
    title,
    content,
    wordCount: countWords(content),
    fileType,
    metadata: {},
  };
}

function parseImage(buffer: Buffer, fileName: string): ParsedContent {
  const title = fileName.replace(/\.[^.]+$/, "");
  return {
    title,
    content: `[Image: ${fileName}] (${(buffer.length / 1024).toFixed(0)} KB)`,
    wordCount: 0,
    fileType: "image",
    metadata: { fileSize: buffer.length },
  };
}

function parseVideo(buffer: Buffer, fileName: string): ParsedContent {
  const title = fileName.replace(/\.[^.]+$/, "");
  return {
    title,
    content: `[Video: ${fileName}] (${(buffer.length / 1024 / 1024).toFixed(1)} MB)`,
    wordCount: 0,
    fileType: "video",
    metadata: { fileSize: buffer.length },
  };
}

export async function parseFile(
  buffer: Buffer,
  mimeType: string,
  fileName: string,
): Promise<ParsedContent> {
  const fileType = detectFileType(mimeType, fileName);

  switch (fileType) {
    case "pdf":
      return parsePdf(buffer);
    case "docx":
      return parseDocx(buffer);
    case "html":
      return parseHtml(buffer.toString("utf-8"));
    case "txt":
    case "md":
      return parsePlainText(buffer.toString("utf-8"), fileType);
    case "image":
      return parseImage(buffer, fileName);
    case "video":
      return parseVideo(buffer, fileName);
    default:
      throw Object.assign(
        new Error(`Unsupported file format: ${fileType}`),
        { code: ErrorCode.INGEST_UNSUPPORTED_FORMAT },
      );
  }
}
