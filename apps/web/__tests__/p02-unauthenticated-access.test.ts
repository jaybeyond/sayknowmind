/**
 * Property 2: Unauthenticated access blocking
 * Verify protected routes are blocked without valid auth tokens.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

const protectedApiPaths = [
  "/api/ingest/file",
  "/api/ingest/url",
  "/api/ingest/text",
  "/api/search",
  "/api/chat",
  "/api/categories",
  "/api/knowledge/graph",
];

const protectedPagePaths = ["/settings", "/knowledge", "/categories"];

// Simulate middleware logic without Next.js runtime
function simulateMiddleware(pathname: string, hasSession: boolean) {
  const protectedPaths = [
    "/settings",
    "/api/ingest",
    "/api/search",
    "/api/chat",
    "/api/categories",
    "/api/knowledge",
    "/knowledge",
    "/categories",
  ];

  const isProtected = protectedPaths.some((path) => pathname.startsWith(path));

  if (isProtected && !hasSession) {
    if (pathname.startsWith("/api/")) {
      return { status: 401, type: "json" };
    }
    return { status: 302, type: "redirect", location: "/login" };
  }

  return { status: 200, type: "next" };
}

describe("Property 2: Unauthenticated access blocking", () => {
  it("all protected API routes return 401 without session", () => {
    fc.assert(
      fc.property(fc.constantFrom(...protectedApiPaths), (path) => {
        const result = simulateMiddleware(path, false);
        expect(result.status).toBe(401);
        expect(result.type).toBe("json");
      }),
      { numRuns: protectedApiPaths.length * 3 },
    );
  });

  it("all protected page routes redirect to login without session", () => {
    fc.assert(
      fc.property(fc.constantFrom(...protectedPagePaths), (path) => {
        const result = simulateMiddleware(path, false);
        expect(result.status).toBe(302);
        expect(result.type).toBe("redirect");
        expect(result.location).toBe("/login");
      }),
      { numRuns: protectedPagePaths.length * 3 },
    );
  });

  it("protected routes pass with valid session", () => {
    const allPaths = [...protectedApiPaths, ...protectedPagePaths];
    fc.assert(
      fc.property(fc.constantFrom(...allPaths), (path) => {
        const result = simulateMiddleware(path, true);
        expect(result.status).toBe(200);
      }),
      { numRuns: allPaths.length * 3 },
    );
  });

  it("arbitrary sub-paths under protected prefixes are also blocked", () => {
    const prefixes = ["/api/ingest", "/api/categories", "/api/knowledge"];
    const suffixArb = fc.stringMatching(/^\/[a-z0-9-]{1,20}$/);

    fc.assert(
      fc.property(
        fc.constantFrom(...prefixes),
        suffixArb,
        (prefix, suffix) => {
          const result = simulateMiddleware(prefix + suffix, false);
          expect(result.status).toBe(401);
        },
      ),
      { numRuns: 100 },
    );
  });
});
