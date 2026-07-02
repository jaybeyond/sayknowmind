/**
 * Property 49: Input-validation & security-header OWASP defenses hold.
 *
 * `lib/security/input-validation.ts` and `lib/security/headers.ts` are the
 * app's first line of defense against path traversal, SSRF, XSS, and clickjacking
 * but shipped with no tests. This suite pins the invariants that actually matter
 * for security (not just happy-path formatting), with property-based fuzzing for
 * the sanitizers.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import {
  sanitizeString,
  isValidEmail,
  isValidUrl,
  isValidUuid,
  sanitizeFilename,
  validateJsonSchema,
  getRateLimitKey,
  MAX_LENGTHS,
} from "@/lib/security/input-validation";
import { getSecurityHeaders } from "@/lib/security/headers";

describe("Property 49a: sanitizeString", () => {
  it("never exceeds the requested max length, strips null bytes, and trims", () => {
    fc.assert(
      fc.property(fc.string(), fc.integer({ min: 1, max: 2000 }), (raw, max) => {
        const out = sanitizeString(raw, max);
        if (out === null) return;
        expect(out.length).toBeLessThanOrEqual(max);
        expect(out).not.toContain("\0");
        expect(out).toBe(out.trim());
      }),
      { numRuns: 100 },
    );
  });

  it("returns null for non-strings and for inputs that are empty after cleaning", () => {
    expect(sanitizeString(null)).toBeNull();
    expect(sanitizeString(undefined)).toBeNull();
    expect(sanitizeString(42)).toBeNull();
    expect(sanitizeString({})).toBeNull();
    expect(sanitizeString("   ")).toBeNull();
    expect(sanitizeString("\0\0")).toBeNull();
    expect(sanitizeString("  hi  ")).toBe("hi");
  });
});

describe("Property 49b: sanitizeFilename prevents path traversal", () => {
  it("output never contains a path separator, '..', or a leading dot", () => {
    fc.assert(
      fc.property(fc.string(), (name) => {
        const out = sanitizeFilename(name);
        expect(out).not.toContain("/");
        expect(out).not.toContain("\\");
        expect(out).not.toContain("..");
        expect(out.startsWith(".")).toBe(false);
        expect(out.length).toBeLessThanOrEqual(MAX_LENGTHS.filename);
      }),
      { numRuns: 100 },
    );
  });

  it("neutralizes classic traversal payloads", () => {
    for (const payload of ["../../etc/passwd", "..\\..\\windows\\system32", "....//....//x", "/abs/path"]) {
      const out = sanitizeFilename(payload);
      expect(out).not.toContain("..");
      expect(out).not.toContain("/");
      expect(out).not.toContain("\\");
    }
  });
});

describe("Property 49c: isValidUrl blocks SSRF-prone schemes", () => {
  it("accepts only http/https", () => {
    expect(isValidUrl("http://example.com")).toBe(true);
    expect(isValidUrl("https://example.com/a?b=c")).toBe(true);
  });

  it("rejects dangerous schemes and malformed urls", () => {
    for (const bad of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "ftp://host/x",
      "data:text/html,<script>",
      "gopher://x",
      "not a url",
      "",
    ]) {
      expect(isValidUrl(bad)).toBe(false);
    }
  });

  it("rejects over-length urls", () => {
    expect(isValidUrl("https://x.com/" + "a".repeat(MAX_LENGTHS.url))).toBe(false);
  });
});

describe("Property 49d: email and uuid validators", () => {
  it("validates well-formed emails and enforces the length cap", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
    expect(isValidEmail("first.last@sub.domain.io")).toBe(true);
    expect(isValidEmail("no-at-sign")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail("a b@c.com")).toBe(false);
    expect(isValidEmail("x".repeat(250) + "@b.com")).toBe(false);
  });

  it("validates v4-shaped uuids and rejects junk", () => {
    expect(isValidUuid("00000000-0000-0000-0000-000000000000")).toBe(true);
    expect(isValidUuid("3F2504E0-4F89-41D3-9A0C-0305E82C3301")).toBe(true);
    expect(isValidUuid("not-a-uuid")).toBe(false);
    expect(isValidUuid("00000000000000000000000000000000")).toBe(false);
    expect(isValidUuid("00000000-0000-0000-0000-00000000000g")).toBe(false);
  });
});

describe("Property 49e: validateJsonSchema rejects missing and unknown fields", () => {
  it("flags non-objects", () => {
    expect(validateJsonSchema(null, ["a"]).valid).toBe(false);
    expect(validateJsonSchema([], ["a"]).valid).toBe(false);
    expect(validateJsonSchema("x", ["a"]).valid).toBe(false);
  });

  it("requires required fields and forbids unknown keys", () => {
    expect(validateJsonSchema({ a: 1 }, ["a"]).valid).toBe(true);
    const missing = validateJsonSchema({}, ["a"]);
    expect(missing.valid).toBe(false);
    expect(missing.errors.join()).toContain("a");

    const unknown = validateJsonSchema({ a: 1, evil: true }, ["a"]);
    expect(unknown.valid).toBe(false);
    expect(unknown.errors.join()).toContain("evil");

    expect(validateJsonSchema({ a: 1, b: 2 }, ["a"], ["b"]).valid).toBe(true);
  });
});

describe("Property 49f: getRateLimitKey", () => {
  it("prefers a user scope over IP", () => {
    expect(getRateLimitKey("1.2.3.4", "u1")).toBe("user:u1");
    expect(getRateLimitKey("1.2.3.4")).toBe("ip:1.2.3.4");
  });
});

describe("Property 49g: getSecurityHeaders enforces OWASP directives", () => {
  it("emits the critical clickjacking / sniffing / transport headers", () => {
    const h = getSecurityHeaders();
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Strict-Transport-Security"]).toContain("max-age=");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    const csp = h["Content-Security-Policy"];
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("default-src 'self'");
  });

  it("merges extra script/connect domains into the CSP", () => {
    const h = getSecurityHeaders({
      scriptSrcDomains: ["https://cdn.example.com"],
      connectSrcDomains: ["https://api.example.com"],
    });
    const csp = h["Content-Security-Policy"];
    expect(csp).toContain("https://cdn.example.com");
    expect(csp).toContain("https://api.example.com");
  });

  it("toggles inline-script allowance", () => {
    expect(getSecurityHeaders({ allowInlineScripts: false })["Content-Security-Policy"]).not.toContain(
      "'unsafe-inline' 'unsafe-inline'",
    );
    const strict = getSecurityHeaders({ allowInlineScripts: false })["Content-Security-Policy"];
    // script-src must not carry unsafe-inline when disabled
    const scriptDirective = strict.split(";").find((d) => d.trim().startsWith("script-src")) ?? "";
    expect(scriptDirective).not.toContain("'unsafe-inline'");
  });

  it("honours a custom HSTS max-age", () => {
    expect(getSecurityHeaders({ hstsMaxAge: 60 })["Strict-Transport-Security"]).toContain("max-age=60");
  });
});
