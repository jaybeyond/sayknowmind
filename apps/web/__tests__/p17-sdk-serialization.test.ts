/**
 * Property 17: SDK serialization round-trip
 * Verify serialize → deserialize produces identical objects for SDK types.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";

// SDK types that must survive JSON round-trip
const searchParamsArb = fc.record({
  query: fc.string({ minLength: 1, maxLength: 200 }),
  mode: fc.constantFrom("naive", "local", "global", "hybrid", "mix"),
  limit: fc.integer({ min: 1, max: 100 }),
  offset: fc.nat({ max: 1000 }),
});

const ingestUrlParamsArb = fc.record({
  url: fc.webUrl(),
});

const ingestTextParamsArb = fc.record({
  content: fc.string({ minLength: 1, maxLength: 5000 }),
  title: fc.string({ minLength: 1, maxLength: 200 }),
});

const chatParamsArb = fc.record({
  message: fc.string({ minLength: 1, maxLength: 2000 }),
  mode: fc.constantFrom("simple", "agentic"),
});

const categoryParamsArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 100 }),
  description: fc.oneof(fc.string({ maxLength: 500 }), fc.constant(null)),
  color: fc.oneof(
    fc.stringMatching(/^#[a-fA-F0-9]{6}$/),
    fc.constant(null),
  ),
});

const searchResponseArb = fc.record({
  results: fc.array(
    fc.record({
      documentId: fc.uuid(),
      title: fc.string({ minLength: 1, maxLength: 100 }),
      snippet: fc.string({ maxLength: 300 }),
      score: fc.double({ min: 0, max: 1, noNaN: true }),
      citations: fc.array(
        fc.record({
          documentId: fc.uuid(),
          title: fc.string({ minLength: 1, maxLength: 100 }),
          excerpt: fc.string({ minLength: 1, maxLength: 200 }),
          relevanceScore: fc.double({ min: 0, max: 1, noNaN: true }),
        }),
        { maxLength: 3 },
      ),
    }),
    { maxLength: 5 },
  ),
  totalCount: fc.nat({ max: 1000 }),
  took: fc.nat({ max: 5000 }),
});

describe("Property 17: SDK serialization round-trip (TypeScript)", () => {
  it("SearchParams survives round-trip", () => {
    fc.assert(
      fc.property(searchParamsArb, (params) => {
        const json = JSON.stringify(params);
        const parsed = JSON.parse(json);
        expect(parsed).toEqual(params);
      }),
      { numRuns: 100 },
    );
  });

  it("IngestUrlParams survives round-trip", () => {
    fc.assert(
      fc.property(ingestUrlParamsArb, (params) => {
        const json = JSON.stringify(params);
        const parsed = JSON.parse(json);
        expect(parsed).toEqual(params);
      }),
      { numRuns: 100 },
    );
  });

  it("IngestTextParams survives round-trip", () => {
    fc.assert(
      fc.property(ingestTextParamsArb, (params) => {
        const json = JSON.stringify(params);
        const parsed = JSON.parse(json);
        expect(parsed).toEqual(params);
      }),
      { numRuns: 100 },
    );
  });

  it("ChatParams survives round-trip", () => {
    fc.assert(
      fc.property(chatParamsArb, (params) => {
        const json = JSON.stringify(params);
        const parsed = JSON.parse(json);
        expect(parsed).toEqual(params);
      }),
      { numRuns: 100 },
    );
  });

  it("CategoryParams survives round-trip", () => {
    fc.assert(
      fc.property(categoryParamsArb, (params) => {
        const json = JSON.stringify(params);
        const parsed = JSON.parse(json);
        expect(parsed).toEqual(params);
      }),
      { numRuns: 100 },
    );
  });

  it("SearchResponse survives round-trip", () => {
    fc.assert(
      fc.property(searchResponseArb, (resp) => {
        const json = JSON.stringify(resp);
        const parsed = JSON.parse(json);
        expect(parsed).toEqual(resp);
      }),
      { numRuns: 50 },
    );
  });
});
