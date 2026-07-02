/**
 * Property 51: UltraRAG pipeline validation rejects malformed/unsafe pipelines.
 *
 * `lib/ultrarag/validator.ts` gates every pipeline before execution. A miss here
 * lets a broken or cyclic pipeline run and hang/crash the executor. Previously
 * untested.
 */
import { describe, it, expect } from "vitest";
import { validatePipeline } from "@/lib/ultrarag/validator";
import type { UltraRAGPipeline } from "@/lib/ultrarag/types";

function basePipeline(over: Partial<UltraRAGPipeline> = {}): UltraRAGPipeline {
  return {
    name: "p",
    version: "1",
    steps: [{ id: "a", type: "crawl", config: {} }],
    ...over,
  };
}

describe("Property 51: validatePipeline", () => {
  it("accepts a minimal well-formed pipeline", () => {
    const r = validatePipeline(basePipeline());
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("rejects non-objects", () => {
    expect(validatePipeline(null).valid).toBe(false);
    expect(validatePipeline("x").valid).toBe(false);
    expect(validatePipeline(42).valid).toBe(false);
  });

  it("requires name and version", () => {
    const r = validatePipeline({ steps: [{ id: "a", type: "crawl", config: {} }] });
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toContain("name");
    expect(r.errors.join()).toContain("version");
  });

  it("requires a non-empty steps array", () => {
    expect(validatePipeline({ name: "p", version: "1", steps: [] }).valid).toBe(false);
    expect(validatePipeline({ name: "p", version: "1" }).valid).toBe(false);
  });

  it("flags duplicate step ids", () => {
    const r = validatePipeline(
      basePipeline({
        steps: [
          { id: "a", type: "crawl", config: {} },
          { id: "a", type: "embed", config: {} },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toContain("Duplicate step id");
  });

  it("rejects unknown step types", () => {
    const r = validatePipeline(
      basePipeline({ steps: [{ id: "a", type: "nope" as never, config: {} }] }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toContain("Invalid step type");
  });

  it("requires a config object on every step", () => {
    const r = validatePipeline(
      basePipeline({ steps: [{ id: "a", type: "crawl", config: undefined as never }] }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toContain("config");
  });

  it("rejects non-positive timeout_ms", () => {
    const bad = validatePipeline(
      basePipeline({ steps: [{ id: "a", type: "crawl", config: {}, timeout_ms: 0 }] }),
    );
    expect(bad.valid).toBe(false);
    expect(bad.errors.join()).toContain("timeout_ms");
    const ok = validatePipeline(
      basePipeline({ steps: [{ id: "a", type: "crawl", config: {}, timeout_ms: 1000 }] }),
    );
    expect(ok.valid).toBe(true);
  });

  it("detects a self-referential cycle", () => {
    const r = validatePipeline(
      basePipeline({ steps: [{ id: "a", type: "crawl", config: {}, depends_on: ["a"] }] }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toContain("Circular dependency");
  });

  it("detects a two-step cycle", () => {
    const r = validatePipeline(
      basePipeline({
        steps: [
          { id: "a", type: "crawl", config: {}, depends_on: ["b"] },
          { id: "b", type: "embed", config: {}, depends_on: ["a"] },
        ],
      }),
    );
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toContain("Circular dependency");
  });

  it("accepts a valid linear dependency chain", () => {
    const r = validatePipeline(
      basePipeline({
        steps: [
          { id: "a", type: "crawl", config: {} },
          { id: "b", type: "extract", config: {}, depends_on: ["a"] },
          { id: "c", type: "embed", config: {}, depends_on: ["b"] },
        ],
      }),
    );
    expect(r.valid).toBe(true);
  });

  it("rejects an invalid on_error policy", () => {
    const r = validatePipeline(basePipeline({ on_error: "boom" as never }));
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toContain("on_error");
  });

  it("warns (but does not fail) on a forward depends_on reference", () => {
    const r = validatePipeline(
      basePipeline({
        steps: [
          { id: "a", type: "crawl", config: {}, depends_on: ["b"] },
          { id: "b", type: "embed", config: {} },
        ],
      }),
    );
    expect(r.valid).toBe(true);
    expect(r.warnings.join()).toContain("b");
  });
});
