/**
 * Property 35: API response JSON format
 * Verify that all API response objects serialize to valid JSON.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import type {
  ErrorResponse,
  SearchResponse,
  ChatResponse,
  IngestStatusResponse,
  GetCategoriesResponse,
  MCPResponse,
  LoginResponse,
  SignupResponse,
  LogoutResponse,
  CreateCategoryResponse,
  DeleteCategoryResponse,
  MergeCategoriesResponse,
  Entity,
} from "@/lib/types";
import { ErrorCode } from "@/lib/types";

// Arbitraries for API response objects

const errorResponseArb = fc.record({
  code: fc.constantFrom(...Object.values(ErrorCode).filter((v) => typeof v === "number") as number[]),
  message: fc.string({ minLength: 1, maxLength: 200 }),
  details: fc.oneof(fc.string(), fc.integer(), fc.constant(undefined)),
  timestamp: fc.date({ min: new Date("2000-01-01"), max: new Date("2030-12-31"), noInvalidDate: true }).map((d) => d.toISOString()),
  requestId: fc.uuid(),
}) as fc.Arbitrary<ErrorResponse>;

const citationArb = fc.record({
  documentId: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 100 }),
  url: fc.oneof(fc.webUrl(), fc.constant(undefined)),
  excerpt: fc.string({ minLength: 1, maxLength: 500 }),
  relevanceScore: fc.double({ min: 0, max: 1, noNaN: true }),
});

const searchResultArb = fc.record({
  documentId: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 100 }),
  snippet: fc.string({ minLength: 0, maxLength: 500 }),
  score: fc.double({ min: 0, max: 1, noNaN: true }),
  citations: fc.array(citationArb, { minLength: 1, maxLength: 3 }),
  entities: fc.constant([] as Entity[]),
});

const searchResponseArb = fc.record({
  results: fc.array(searchResultArb, { maxLength: 5 }),
  totalCount: fc.nat({ max: 1000 }),
  took: fc.nat({ max: 5000 }),
}) as fc.Arbitrary<SearchResponse>;

const chatResponseArb = fc.record({
  conversationId: fc.uuid(),
  messageId: fc.uuid(),
  answer: fc.string({ minLength: 1, maxLength: 2000 }),
  citations: fc.array(citationArb, { maxLength: 3 }),
  relatedDocuments: fc.array(fc.uuid(), { maxLength: 5 }),
  agentSteps: fc.constant(undefined),
}) as fc.Arbitrary<ChatResponse>;

const ingestStatusArb = fc.record({
  jobId: fc.uuid(),
  status: fc.constantFrom("pending", "processing", "completed", "failed"),
  progress: fc.integer({ min: 0, max: 100 }),
  error: fc.oneof(fc.string(), fc.constant(undefined)),
}) as fc.Arbitrary<IngestStatusResponse>;

const mcpResponseArb = fc.record({
  jsonrpc: fc.constant("2.0" as const),
  id: fc.oneof(fc.uuid(), fc.integer()),
  result: fc.oneof(fc.string(), fc.integer(), fc.constant(undefined)),
  error: fc.oneof(
    fc.record({
      code: fc.integer(),
      message: fc.string(),
      data: fc.constant(undefined),
    }),
    fc.constant(undefined),
  ),
}) as fc.Arbitrary<MCPResponse>;

const loginResponseArb = fc.record({
  userId: fc.uuid(),
  token: fc.stringMatching(/^[a-f0-9]{64}$/),
  expiresAt: fc.date({ min: new Date("2000-01-01"), max: new Date("2100-12-31") }).filter((d) => !isNaN(d.getTime())).map((d) => d.toISOString()),
}) as fc.Arbitrary<LoginResponse>;

describe("Property 35: API response JSON format", () => {
  it("ErrorResponse serializes to valid JSON", () => {
    fc.assert(
      fc.property(errorResponseArb, (resp) => {
        const json = JSON.stringify(resp);
        expect(() => JSON.parse(json)).not.toThrow();
        const parsed = JSON.parse(json);
        expect(parsed).toHaveProperty("code");
        expect(parsed).toHaveProperty("message");
        expect(parsed).toHaveProperty("timestamp");
        expect(parsed).toHaveProperty("requestId");
      }),
      { numRuns: 100 },
    );
  });

  it("SearchResponse serializes to valid JSON", () => {
    fc.assert(
      fc.property(searchResponseArb, (resp) => {
        const json = JSON.stringify(resp);
        expect(() => JSON.parse(json)).not.toThrow();
        const parsed = JSON.parse(json);
        expect(parsed).toHaveProperty("results");
        expect(parsed).toHaveProperty("totalCount");
        expect(Array.isArray(parsed.results)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  it("ChatResponse serializes to valid JSON", () => {
    fc.assert(
      fc.property(chatResponseArb, (resp) => {
        const json = JSON.stringify(resp);
        expect(() => JSON.parse(json)).not.toThrow();
        const parsed = JSON.parse(json);
        expect(parsed).toHaveProperty("conversationId");
        expect(parsed).toHaveProperty("answer");
      }),
      { numRuns: 100 },
    );
  });

  it("IngestStatusResponse serializes to valid JSON", () => {
    fc.assert(
      fc.property(ingestStatusArb, (resp) => {
        const json = JSON.stringify(resp);
        expect(() => JSON.parse(json)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });

  it("MCPResponse serializes to valid JSON", () => {
    fc.assert(
      fc.property(mcpResponseArb, (resp) => {
        const json = JSON.stringify(resp);
        expect(() => JSON.parse(json)).not.toThrow();
        const parsed = JSON.parse(json);
        expect(parsed.jsonrpc).toBe("2.0");
      }),
      { numRuns: 100 },
    );
  });

  it("LoginResponse serializes to valid JSON", () => {
    fc.assert(
      fc.property(loginResponseArb, (resp) => {
        const json = JSON.stringify(resp);
        expect(() => JSON.parse(json)).not.toThrow();
      }),
      { numRuns: 100 },
    );
  });
});
