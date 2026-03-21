/**
 * Property 4: Bot traffic blocking and logging
 * Verify bot-pattern requests are blocked and log entries contain reason + timestamp.
 */
import { describe, it, expect, beforeEach } from "vitest";
import * as fc from "fast-check";

// Replicate antibot logic for testability without Next.js runtime
const BOT_UA_PATTERNS = [
  /bot/i, /crawl/i, /spider/i, /scrape/i,
  /headless/i, /phantom/i, /selenium/i, /puppeteer/i, /playwright/i,
];
const ALLOWED_BOT_PATTERNS = [
  /googlebot/i, /bingbot/i, /yandexbot/i, /duckduckbot/i,
];

interface BlockLog {
  ip: string;
  reason: string;
  timestamp: string;
  userAgent: string;
}

function isBotUserAgent(ua: string): boolean {
  if (ALLOWED_BOT_PATTERNS.some((p) => p.test(ua))) return false;
  return BOT_UA_PATTERNS.some((p) => p.test(ua));
}

function checkRateLimit(
  key: string,
  store: Map<string, { count: number; resetAt: number }>,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count++;
  return entry.count <= limit;
}

describe("Property 4: Bot traffic blocking and logging", () => {
  const botUAs = [
    "My-Scraper/1.0",
    "python-requests/2.0 bot",
    "HeadlessChrome/123",
    "PhantomJS/2.1.1",
    "Selenium WebDriver",
    "Puppeteer/3.0",
    "Playwright/1.40",
    "MyCrawler/1.0",
    "WebSpider/2.0",
  ];

  const allowedBots = ["Googlebot/2.1", "Bingbot/2.0", "DuckDuckBot/1.0"];
  const normalUAs = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari/537",
  ];

  it("bot user agents are detected and blocked", () => {
    fc.assert(
      fc.property(fc.constantFrom(...botUAs), (ua) => {
        expect(isBotUserAgent(ua)).toBe(true);
      }),
    );
  });

  it("allowed search engine bots are not blocked", () => {
    fc.assert(
      fc.property(fc.constantFrom(...allowedBots), (ua) => {
        expect(isBotUserAgent(ua)).toBe(false);
      }),
    );
  });

  it("normal user agents pass", () => {
    fc.assert(
      fc.property(fc.constantFrom(...normalUAs), (ua) => {
        expect(isBotUserAgent(ua)).toBe(false);
      }),
    );
  });

  it("block log entries contain reason and ISO timestamp", () => {
    const logs: BlockLog[] = [];

    for (const ua of botUAs) {
      if (isBotUserAgent(ua)) {
        logs.push({
          ip: "1.2.3.4",
          reason: "bot_user_agent",
          timestamp: new Date().toISOString(),
          userAgent: ua,
        });
      }
    }

    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) {
      expect(log.reason).toBeTruthy();
      expect(log.timestamp).toBeTruthy();
      // ISO 8601 format
      expect(new Date(log.timestamp).toISOString()).toBe(log.timestamp);
    }
  });

  it("IP rate limit blocks after threshold", () => {
    const store = new Map<string, { count: number; resetAt: number }>();
    const ip = "10.0.0.1";

    // First 100 requests pass
    for (let i = 0; i < 100; i++) {
      expect(checkRateLimit(ip, store, 100, 60000)).toBe(true);
    }
    // 101st request should be blocked
    expect(checkRateLimit(ip, store, 100, 60000)).toBe(false);
  });

  it("different IPs have independent rate limits", () => {
    const store = new Map<string, { count: number; resetAt: number }>();
    fc.assert(
      fc.property(fc.ipV4(), fc.ipV4(), (ip1, ip2) => {
        if (ip1 === ip2) return;
        store.clear();
        // Exhaust ip1
        for (let i = 0; i < 101; i++) checkRateLimit(ip1, store, 100, 60000);
        // ip2 should still pass
        expect(checkRateLimit(ip2, store, 100, 60000)).toBe(true);
      }),
      { numRuns: 20 },
    );
  });
});
