import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import * as cheerio from "cheerio";
import { lookup as dnsLookup } from "dns/promises";
import { ErrorCode } from "@/lib/types";

export interface FetchedContent {
  title: string;
  content: string;
  url: string;
  wordCount: number;
  metadata: {
    author?: string;
    publishedAt?: string;
    language?: string;
    siteName?: string;
    ogImage?: string;
  };
}

const FETCH_TIMEOUT = 30_000;

/** Returns true if the IPv4 address is in a private/internal range. */
function isPrivateIp(ip: string): boolean {
  // IPv6 loopback / link-local
  if (ip === "::1" || ip.startsWith("fe80:") || ip.startsWith("fc") || ip.startsWith("fd")) return true;

  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p))) return false;

  const [a, b] = parts;
  return (
    a === 10 ||                            // 10.0.0.0/8
    a === 127 ||                           // 127.0.0.0/8 loopback
    (a === 172 && b >= 16 && b <= 31) ||   // 172.16.0.0/12
    (a === 192 && b === 168) ||            // 192.168.0.0/16
    (a === 169 && b === 254) ||            // 169.254.0.0/16 link-local / AWS metadata
    a === 0                                // 0.0.0.0/8
  );
}

export async function validateUrl(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Only HTTP/HTTPS URLs are supported");
    }
  } catch {
    throw Object.assign(new Error(`Invalid URL: ${url}`), {
      code: ErrorCode.INGEST_INVALID_URL,
    });
  }

  // SSRF guard: resolve hostname → reject private/internal IPs
  try {
    const { address } = await dnsLookup(parsed.hostname, { verbatim: false });
    if (isPrivateIp(address)) {
      throw Object.assign(
        new Error(`URL resolves to a private network address: ${url}`),
        { code: ErrorCode.INGEST_INVALID_URL },
      );
    }
  } catch (err) {
    if ((err as { code?: number }).code === ErrorCode.INGEST_INVALID_URL) {
      throw err;
    }
    // DNS resolution failed (unknown host etc.) — let the fetch fail naturally
  }

  return parsed;
}

/**
 * fetch() that re-validates the target on EVERY redirect hop — closing
 * SSRF-via-redirect, where an allowed public URL 302s to a private/internal
 * address (e.g. cloud metadata 169.254.169.254). Each hop runs validateUrl(),
 * which rejects private resolutions, so a redirect into the internal network
 * throws instead of being followed.
 */
export async function safeFetch(url: string, init?: RequestInit): Promise<Response> {
  let target = (await validateUrl(url)).toString();
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(target, { ...init, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      // Throws if the redirect target resolves to a private/internal address.
      target = (await validateUrl(new URL(location, target).toString())).toString();
      continue;
    }
    return res;
  }
  throw new Error(`Too many redirects fetching ${url}`);
}

function countWords(text: string): number {
  const cjk = text.match(
    /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g,
  );
  const latin = text.match(/[a-zA-Z0-9]+/g);
  return (cjk?.length ?? 0) + (latin?.length ?? 0);
}

function extractOgImage(html: string): string | undefined {
  const $ = cheerio.load(html);
  return (
    $('meta[property="og:image"]').attr("content") ||
    $('meta[name="twitter:image"]').attr("content") ||
    $('meta[property="og:image:url"]').attr("content") ||
    undefined
  );
}

function extractWithReadability(html: string, url: string): FetchedContent | null {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article || !article.textContent?.trim()) return null;

  const content = article.textContent!.trim();
  return {
    title: article.title || "",
    content,
    url,
    wordCount: countWords(content),
    metadata: {
      author: article.byline || undefined,
      siteName: article.siteName || undefined,
      ogImage: extractOgImage(html),
    },
  };
}

function extractWithCheerio(html: string, url: string): FetchedContent {
  const $ = cheerio.load(html);

  // Remove non-content elements
  $("script, style, nav, footer, header, aside, iframe, noscript").remove();

  const title = $("title").text().trim() ||
    $('meta[property="og:title"]').attr("content") ||
    $("h1").first().text().trim() ||
    "";

  const author =
    $('meta[name="author"]').attr("content") ||
    $('meta[property="article:author"]').attr("content") ||
    undefined;

  const publishedAt =
    $('meta[property="article:published_time"]').attr("content") ||
    $('time[datetime]').attr("datetime") ||
    undefined;

  // Extract main content area
  const mainSelectors = ["article", "main", '[role="main"]', ".post-content", ".entry-content"];
  let content = "";
  for (const sel of mainSelectors) {
    const text = $(sel).text().trim();
    if (text.length > 100) {
      content = text;
      break;
    }
  }
  if (!content) {
    content = $("body").text().trim();
  }

  // Clean up whitespace
  content = content.replace(/\s+/g, " ").trim();

  const ogImage =
    $('meta[property="og:image"]').attr("content") ||
    $('meta[name="twitter:image"]').attr("content") ||
    undefined;

  return {
    title,
    content,
    url,
    wordCount: countWords(content),
    metadata: { author, publishedAt, ogImage },
  };
}

export async function fetchUrl(url: string): Promise<FetchedContent> {
  const parsedUrl = await validateUrl(url);

  let response: Response;
  try {
    // safeFetch re-validates every redirect hop (redirect: "manual"), closing
    // SSRF-via-redirect where a public URL 302s to a private/internal address.
    response = await safeFetch(parsedUrl.toString(), {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; SayKnowMind/0.1; +https://github.com/sayknowmind)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,ko;q=0.8,ja;q=0.7,zh;q=0.6",
      },
    });
  } catch (err) {
    // Preserve SSRF/validation errors (private-network redirect, invalid URL)
    // instead of masking them as a generic fetch failure.
    if ((err as { code?: number }).code !== undefined) throw err;
    throw Object.assign(
      new Error(`Failed to fetch URL: ${url} - ${(err as Error).message}`),
      { code: ErrorCode.INGEST_FETCH_FAILED },
    );
  }

  if (!response.ok) {
    throw Object.assign(
      new Error(`HTTP ${response.status} fetching ${url}`),
      { code: ErrorCode.INGEST_FETCH_FAILED },
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
    throw Object.assign(
      new Error(`Unsupported content type: ${contentType}`),
      { code: ErrorCode.INGEST_PARSE_FAILED },
    );
  }

  const html = await response.text();

  // Try Readability first, fall back to Cheerio
  const readabilityResult = extractWithReadability(html, parsedUrl.toString());
  if (readabilityResult && readabilityResult.content.length > 50) {
    return readabilityResult;
  }

  const cheerioResult = extractWithCheerio(html, parsedUrl.toString());
  if (!cheerioResult.content) {
    throw Object.assign(
      new Error(`Could not extract content from ${url}`),
      { code: ErrorCode.INGEST_PARSE_FAILED },
    );
  }

  return cheerioResult;
}
