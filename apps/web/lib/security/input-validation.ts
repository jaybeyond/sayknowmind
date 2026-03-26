/**
 * Input Validation & Sanitization — OWASP Defense
 *
 * Provides validation helpers for API inputs to prevent:
 * - SQL Injection (parameterized queries are primary defense)
 * - XSS (output encoding + CSP)
 * - Command Injection
 * - Path Traversal
 * - SSRF (see url-fetcher.ts)
 */

/** Maximum allowed string lengths for common fields */
export const MAX_LENGTHS = {
  title: 500,
  content: 5_000_000,  // 5MB text
  url: 2048,
  query: 1000,
  categoryName: 200,
  email: 254,
  password: 128,
  tag: 100,
  filename: 255,
} as const;

/** Validate and sanitize a string input */
export function sanitizeString(input: unknown, maxLength: number = 10_000): string | null {
  if (input == null) return null;
  if (typeof input !== "string") return null;
  // Remove null bytes
  let clean = input.replace(/\0/g, "");
  // Trim and enforce max length
  clean = clean.trim().slice(0, maxLength);
  return clean || null;
}

/** Validate email format */
export function isValidEmail(email: string): boolean {
  if (email.length > MAX_LENGTHS.email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Validate URL format (HTTP/HTTPS only) */
export function isValidUrl(url: string): boolean {
  if (url.length > MAX_LENGTHS.url) return false;
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

/** Validate UUID format */
export function isValidUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/** Sanitize filename to prevent path traversal */
export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[/\\:*?"<>|]/g, "_")  // Remove dangerous chars
    .replace(/\.\./g, "_")           // Prevent path traversal
    .replace(/^\.+/, "")             // Remove leading dots
    .slice(0, MAX_LENGTHS.filename);
}

/** Validate JSON schema (lightweight) */
export function validateJsonSchema(
  data: unknown,
  requiredFields: string[],
  optionalFields?: string[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { valid: false, errors: ["Input must be a JSON object"] };
  }

  const obj = data as Record<string, unknown>;
  const allAllowed = new Set([...requiredFields, ...(optionalFields ?? [])]);

  for (const field of requiredFields) {
    if (obj[field] === undefined || obj[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  for (const key of Object.keys(obj)) {
    if (!allAllowed.has(key)) {
      errors.push(`Unknown field: ${key}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Rate limit key generator from request */
export function getRateLimitKey(ip: string, userId?: string): string {
  return userId ? `user:${userId}` : `ip:${ip}`;
}
