/**
 * Property 56: File parsing extracts content & word counts and rejects unknowns.
 *
 * `lib/ingest/parsers.ts` is the front door for every uploaded file. It must
 * route by MIME/extension, count words correctly across CJK + latin, extract
 * markdown/HTML titles, and reject unsupported formats with the right error
 * code. Binary-only formats (pdf/docx) are exercised elsewhere; this covers the
 * text/html/media/detection paths. Previously untested.
 */
import { describe, it, expect } from "vitest";
import { parseFile } from "@/lib/ingest/parsers";
import { ErrorCode } from "@/lib/types";

const buf = (s: string) => Buffer.from(s, "utf-8");

describe("Property 56: parseFile", () => {
  it("parses plain text and counts latin words", async () => {
    const r = await parseFile(buf("hello world foo bar"), "text/plain", "a.txt");
    expect(r.fileType).toBe("txt");
    expect(r.content).toBe("hello world foo bar");
    expect(r.wordCount).toBe(4);
  });

  it("extracts a markdown H1 title from the first line", async () => {
    const r = await parseFile(buf("# My Title\n\nSome body content here."), "text/markdown", "n.md");
    expect(r.fileType).toBe("md");
    expect(r.title).toBe("My Title");
  });

  it("counts CJK characters as individual words", async () => {
    const r = await parseFile(buf("한국어 텍스트 test"), "text/plain", "k.txt");
    // 6 hangul syllable chars + 1 latin token ("test")
    expect(r.wordCount).toBe(7);
  });

  it("parses HTML and extracts readable text", async () => {
    const html = `<!doctype html><html><head><title>Doc Title</title></head>
      <body><article><h1>Heading</h1><p>${"This is a meaningful paragraph of article content. ".repeat(8)}</p></article></body></html>`;
    const r = await parseFile(buf(html), "text/html", "page.html");
    expect(r.fileType).toBe("html");
    expect(r.content).toContain("meaningful paragraph");
    expect(r.wordCount).toBeGreaterThan(0);
  });

  it("represents images as a placeholder with file size metadata", async () => {
    const bytes = Buffer.alloc(2048, 1);
    const r = await parseFile(bytes, "image/png", "pic.png");
    expect(r.fileType).toBe("image");
    expect(r.wordCount).toBe(0);
    expect(r.title).toBe("pic");
    expect(r.content).toContain("[Image: pic.png]");
    expect(r.metadata.fileSize).toBe(2048);
  });

  it("represents videos as a placeholder", async () => {
    const r = await parseFile(Buffer.alloc(1024 * 1024, 1), "video/mp4", "clip.mp4");
    expect(r.fileType).toBe("video");
    expect(r.content).toContain("[Video: clip.mp4]");
    expect(r.metadata.fileSize).toBe(1024 * 1024);
  });

  it("falls back to file extension when MIME is generic octet-stream", async () => {
    const r = await parseFile(buf("plain body"), "application/octet-stream", "notes.md");
    expect(r.fileType).toBe("md");
  });

  it("rejects unsupported formats with INGEST_UNSUPPORTED_FORMAT", async () => {
    await expect(parseFile(buf("x"), "application/x-evil", "thing.xyz")).rejects.toMatchObject({
      code: ErrorCode.INGEST_UNSUPPORTED_FORMAT,
    });
  });

  it("trims surrounding whitespace from extracted content", async () => {
    const r = await parseFile(buf("   padded text   "), "text/plain", "p.txt");
    expect(r.content).toBe("padded text");
  });
});
