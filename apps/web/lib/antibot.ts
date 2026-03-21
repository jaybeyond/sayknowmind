import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// In-memory rate limiter and bot detection
//
// SCALING NOTE: This implementation uses in-process Maps, which means:
// - Rate limit state is NOT shared across multiple server instances.
// - Each instance tracks limits independently — a user hitting N instances
//   effectively gets N× the configured limit.
// - State is lost on restart.
//
// For multi-instance deployments, replace ipLimits/userLimits Maps with a
// shared store such as Redis (INCR + EXPIRE) or PostgreSQL (advisory locks).
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface BlockLog {
  ip: string;
  reason: string;
  timestamp: string;
  userAgent: string;
}

const ipLimits = new Map<string, RateLimitEntry>();
const userLimits = new Map<string, RateLimitEntry>();
const blockLogs: BlockLog[] = [];

const IP_RATE_LIMIT = 100; // requests per minute
const IP_WINDOW_MS = 60 * 1000; // 1 minute

const USER_RATE_LIMIT = 1000; // requests per hour
const USER_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// Known bot User-Agent patterns
const BOT_UA_PATTERNS = [
  /bot/i,
  /crawl/i,
  /spider/i,
  /scrape/i,
  /headless/i,
  /phantom/i,
  /selenium/i,
  /puppeteer/i,
  /playwright/i,
];

// Allowlisted bot User-Agent patterns (e.g. search engines)
const ALLOWED_BOT_PATTERNS = [
  /googlebot/i,
  /bingbot/i,
  /yandexbot/i,
  /duckduckbot/i,
];

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

function logBlock(ip: string, reason: string, userAgent: string) {
  const entry: BlockLog = {
    ip,
    reason,
    timestamp: new Date().toISOString(),
    userAgent,
  };
  blockLogs.push(entry);

  // Keep only last 10000 log entries in memory
  if (blockLogs.length > 10000) {
    blockLogs.splice(0, blockLogs.length - 10000);
  }
}

function checkRateLimit(
  key: string,
  store: Map<string, RateLimitEntry>,
  limit: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  entry.count++;
  if (entry.count > limit) {
    return false;
  }

  return true;
}

function isBotUserAgent(userAgent: string): boolean {
  // Allow known search engine bots
  if (ALLOWED_BOT_PATTERNS.some((pattern) => pattern.test(userAgent))) {
    return false;
  }
  // Block suspicious bot patterns
  return BOT_UA_PATTERNS.some((pattern) => pattern.test(userAgent));
}

/**
 * AntiBot middleware for Next.js API routes.
 * Checks User-Agent patterns, IP rate limits, and user rate limits.
 * Returns null if the request is allowed, or a NextResponse to block it.
 */
export function checkAntiBot(
  request: NextRequest,
  userId?: string
): NextResponse | null {
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") ?? "";

  // 1. Bot User-Agent detection
  if (isBotUserAgent(userAgent)) {
    logBlock(ip, "bot_user_agent", userAgent);
    return NextResponse.json(
      {
        code: 9003,
        message: "Request blocked",
        timestamp: new Date().toISOString(),
      },
      { status: 403 }
    );
  }

  // 2. Missing User-Agent
  if (!userAgent) {
    logBlock(ip, "missing_user_agent", "");
    return NextResponse.json(
      {
        code: 9003,
        message: "Request blocked",
        timestamp: new Date().toISOString(),
      },
      { status: 403 }
    );
  }

  // 3. IP-based rate limiting (100 req/min)
  if (!checkRateLimit(ip, ipLimits, IP_RATE_LIMIT, IP_WINDOW_MS)) {
    logBlock(ip, "ip_rate_limit_exceeded", userAgent);
    return NextResponse.json(
      {
        code: 9003,
        message: "Rate limit exceeded",
        timestamp: new Date().toISOString(),
      },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  // 4. User-based rate limiting (1000 req/hour)
  if (userId && !checkRateLimit(userId, userLimits, USER_RATE_LIMIT, USER_WINDOW_MS)) {
    logBlock(ip, "user_rate_limit_exceeded", userAgent);
    return NextResponse.json(
      {
        code: 9003,
        message: "Rate limit exceeded",
        timestamp: new Date().toISOString(),
      },
      { status: 429, headers: { "Retry-After": "3600" } }
    );
  }

  return null; // Request is allowed
}

/**
 * Get recent block logs for monitoring.
 */
export function getBlockLogs(limit = 100): BlockLog[] {
  return blockLogs.slice(-limit);
}

/**
 * Periodic cleanup of expired rate limit entries.
 * Call this on a timer in production.
 */
export function cleanupRateLimits() {
  const now = Date.now();
  for (const [key, entry] of ipLimits) {
    if (now > entry.resetAt) ipLimits.delete(key);
  }
  for (const [key, entry] of userLimits) {
    if (now > entry.resetAt) userLimits.delete(key);
  }
}
