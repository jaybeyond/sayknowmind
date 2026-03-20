/**
 * Property 36: API response serialization round-trip
 * Verify serialize → deserialize produces identical objects.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { ErrorCode } from "@/lib/types";

const errorResponseArb = fc.record({
  code: fc.constantFrom(...Object.values(ErrorCode).filter((v) => typeof v === "number") as number[]),
  message: fc.string({ minLength: 1, maxLength: 200 }),
  timestamp: fc.date({ min: new Date("2000-01-01"), max: new Date("2030-12-31") }).filter((d) => !isNaN(d.getTime())).map((d) => d.toISOString()),
  requestId: fc.uuid(),
});

const searchResultArb = fc.record({
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
  entities: fc.constant([]),
});

const searchResponseArb = fc.record({
  results: fc.array(searchResultArb, { maxLength: 5 }),
  totalCount: fc.nat({ max: 1000 }),
  took: fc.nat({ max: 5000 }),
});

const chatResponseArb = fc.record({
  conversationId: fc.uuid(),
  messageId: fc.uuid(),
  answer: fc.string({ minLength: 1, maxLength: 1000 }),
  citations: fc.array(
    fc.record({
      documentId: fc.uuid(),
      title: fc.string({ minLength: 1, maxLength: 100 }),
      excerpt: fc.string({ minLength: 1, maxLength: 200 }),
      relevanceScore: fc.double({ min: 0, max: 1, noNaN: true }),
    }),
    { maxLength: 3 },
  ),
  relatedDocuments: fc.array(fc.uuid(), { maxLength: 5 }),
});

const mcpResponseArb = fc.record({
  jsonrpc: fc.constant("2.0"),
  id: fc.oneof(fc.uuid(), fc.integer()),
  result: fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
});

describe("Property 36: API response serialization round-trip", () => {
  it("ErrorResponse survives JSON round-trip", () => {
    fc.assert(
      fc.property(errorResponseArb, (original) => {
        const serialized = JSON.stringify(original);
        const deserialized = JSON.parse(serialized);
        expect(deserialized).toEqual(original);
      }),
      { numRuns: 100 },
    );
  });

  it("SearchResponse survives JSON round-trip", () => {
    fc.assert(
      fc.property(searchResponseArb, (original) => {
        const serialized = JSON.stringify(original);
        const deserialized = JSON.parse(serialized);
        expect(deserialized).toEqual(original);
      }),
      { numRuns: 100 },
    );
  });

  it("ChatResponse survives JSON round-trip", () => {
    fc.assert(
      fc.property(chatResponseArb, (original) => {
        const serialized = JSON.stringify(original);
        const deserialized = JSON.parse(serialized);
        expect(deserialized).toEqual(original);
      }),
      { numRuns: 100 },
    );
  });

  it("MCPResponse survives JSON round-trip", () => {
    fc.assert(
      fc.property(mcpResponseArb, (original) => {
        const serialized = JSON.stringify(original);
        const deserialized = JSON.parse(serialized);
        expect(deserialized).toEqual(original);
      }),
      { numRuns: 100 },
    );
  });
});
