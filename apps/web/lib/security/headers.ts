/**
 * Security Headers — OWASP Top 10 Defense
 *
 * Provides HTTP security headers for all responses:
 * - Content-Security-Policy (CSP)
 * - Strict-Transport-Security (HSTS)
 * - X-Content-Type-Options
 * - X-Frame-Options
 * - X-XSS-Protection
 * - Referrer-Policy
 * - Permissions-Policy
 */

export interface SecurityHeadersConfig {
  /** Allow inline scripts (needed for Next.js) */
  allowInlineScripts?: boolean;
  /** Additional CSP script-src domains */
  scriptSrcDomains?: string[];
  /** Additional CSP connect-src domains */
  connectSrcDomains?: string[];
  /** HSTS max-age in seconds (default: 1 year) */
  hstsMaxAge?: number;
}

const DEFAULT_CONFIG: SecurityHeadersConfig = {
  allowInlineScripts: true,
  scriptSrcDomains: [],
  connectSrcDomains: [],
  hstsMaxAge: 31_536_000,
};

export function getSecurityHeaders(config: SecurityHeadersConfig = {}): Record<string, string> {
  const c = { ...DEFAULT_CONFIG, ...config };

  const scriptSrc = [
    "'self'",
    ...(c.allowInlineScripts ? ["'unsafe-inline'"] : []),
    ...(c.scriptSrcDomains ?? []),
  ].join(" ");

  const connectSrc = [
    "'self'",
    "http://localhost:*",
    "ws://localhost:*",
    ...(c.connectSrcDomains ?? []),
  ].join(" ");

  const csp = [
    `default-src 'self'`,
    `script-src ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline' https://api.fontshare.com`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data: https://cdn.fontshare.com`,
    `connect-src ${connectSrc}`,
    `frame-src 'self' https://www.instagram.com https://www.youtube.com https://www.tiktok.com https://player.vimeo.com`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ].join("; ");

  return {
    "Content-Security-Policy": csp,
    "Strict-Transport-Security": `max-age=${c.hstsMaxAge}; includeSubDomains; preload`,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "X-DNS-Prefetch-Control": "off",
    "X-Download-Options": "noopen",
    "X-Permitted-Cross-Domain-Policies": "none",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
}
