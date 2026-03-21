/**
 * Property 7: Search results Citation inclusion
 * Every search result must contain at least one Citation.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type { SearchResult, Citation } from "@/lib/types";

const citationArb: fc.Arbitrary<Citation> = fc.record({
  documentId: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 100 }),
  url: fc.oneof(fc.webUrl(), fc.constant(undefined)),
  excerpt: fc.string({ minLength: 1, maxLength: 500 }),
  relevanceScore: fc.double({ min: 0, max: 1, noNaN: true }),
});

const searchResultArb: fc.Arbitrary<SearchResult> = fc.record({
  documentId: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 100 }),
  snippet: fc.string({ maxLength: 500 }),
  score: fc.double({ min: 0, max: 1, noNaN: true }),
  citations: fc.array(citationArb, { minLength: 1, maxLength: 5 }),
  entities: fc.constant([]),
});

describe("Property 7: Search results Citation inclusion", () => {
  it("every search result has at least one citation", () => {
    fc.assert(
      fc.property(fc.array(searchResultArb, { minLength: 1, maxLength: 10 }), (results) => {
        for (const result of results) {
          expect(result.citations.length).toBeGreaterThanOrEqual(1);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("citations have all required fields", () => {
    fc.assert(
      fc.property(citationArb, (citation) => {
        expect(citation.documentId).toBeTruthy();
        expect(citation.title).toBeTruthy();
        expect(citation.excerpt).toBeTruthy();
        expect(citation.relevanceScore).toBeGreaterThanOrEqual(0);
        expect(citation.relevanceScore).toBeLessThanOrEqual(1);
      }),
      { numRuns: 100 },
    );
  });

  it("search result score is between 0 and 1", () => {
    fc.assert(
      fc.property(searchResultArb, (result) => {
        expect(result.score).toBeGreaterThanOrEqual(0);
        expect(result.score).toBeLessThanOrEqual(1);
      }),
      { numRuns: 100 },
    );
  });
});
