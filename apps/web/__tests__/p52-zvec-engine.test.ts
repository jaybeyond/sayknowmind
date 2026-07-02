/**
 * Property 52: zvec in-process vector engine returns correct nearest neighbors.
 *
 * `lib/zvec/engine.ts` is the lightweight LSH vector index used for hybrid
 * search. Bugs here surface as silently wrong "related" results. Previously
 * untested. LSH search is approximate, so exactness is asserted on the
 * brute-force path and search() is held to its structural invariants.
 */
import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { ZvecEngine } from "@/lib/zvec/engine";

const DIM = 8;

function randVec(): number[] {
  return Array.from({ length: DIM }, () => Math.random() * 2 - 1);
}

describe("Property 52: ZvecEngine", () => {
  it("rejects vectors of the wrong dimension", () => {
    const e = new ZvecEngine({ dimensions: DIM });
    expect(() => e.insert("x", [1, 2, 3])).toThrow(/dimension/i);
  });

  it("insert is idempotent on id (update, not duplicate)", () => {
    const e = new ZvecEngine({ dimensions: DIM });
    e.insert("x", randVec());
    e.insert("x", randVec());
    expect(e.size).toBe(1);
  });

  it("remove deletes and reports presence", () => {
    const e = new ZvecEngine({ dimensions: DIM });
    e.insert("x", randVec());
    expect(e.remove("x")).toBe(true);
    expect(e.remove("x")).toBe(false);
    expect(e.size).toBe(0);
  });

  it("exactSearch ranks the identical vector first with score ~1", () => {
    const e = new ZvecEngine({ dimensions: DIM });
    const target = randVec();
    e.insert("target", target);
    for (let i = 0; i < 20; i++) e.insert(`r${i}`, randVec());
    const [top] = e.exactSearch(target, 5);
    expect(top.id).toBe("target");
    expect(top.score).toBeCloseTo(1, 5);
  });

  it("exactSearch returns at most topK results sorted by descending score", () => {
    const e = new ZvecEngine({ dimensions: DIM });
    for (let i = 0; i < 30; i++) e.insert(`r${i}`, randVec());
    const res = e.exactSearch(randVec(), 7);
    expect(res.length).toBe(7);
    for (let i = 1; i < res.length; i++) {
      expect(res[i - 1].score).toBeGreaterThanOrEqual(res[i].score);
    }
  });

  it("cosine scores stay within [-1, 1] for normalized vectors", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(...Array.from({ length: DIM }, () => fc.double({ min: -5, max: 5, noNaN: true }))), { minLength: 1, maxLength: 15 }), (vecs) => {
        const e = new ZvecEngine({ dimensions: DIM });
        vecs.forEach((v, i) => {
          // skip all-zero vectors (undefined direction)
          if (v.some((x) => x !== 0)) e.insert(`v${i}`, v as number[]);
        });
        if (e.size === 0) return;
        for (const r of e.exactSearch(randVec(), e.size)) {
          expect(r.score).toBeGreaterThanOrEqual(-1.0001);
          expect(r.score).toBeLessThanOrEqual(1.0001);
        }
      }),
      { numRuns: 30 },
    );
  });

  it("search returns the self vector among results (brute-force fallback)", () => {
    const e = new ZvecEngine({ dimensions: DIM });
    const target = randVec();
    e.insert("target", target);
    for (let i = 0; i < 5; i++) e.insert(`r${i}`, randVec());
    const ids = e.search(target, 6).map((r) => r.id);
    expect(ids).toContain("target");
  });

  it("metadata is preserved through search", () => {
    const e = new ZvecEngine({ dimensions: DIM });
    const v = randVec();
    e.insert("x", v, { kind: "note", n: 7 });
    const [top] = e.exactSearch(v, 1);
    expect(top.metadata).toEqual({ kind: "note", n: 7 });
  });

  it("serialize → deserialize preserves vectors, metadata and ranking", () => {
    const e = new ZvecEngine({ dimensions: DIM });
    const target = randVec();
    e.insert("target", target, { tag: "t" });
    for (let i = 0; i < 10; i++) e.insert(`r${i}`, randVec());

    const restored = ZvecEngine.deserialize(e.serialize());
    expect(restored.size).toBe(e.size);

    const a = e.exactSearch(target, 5);
    const b = restored.exactSearch(target, 5);
    expect(b.map((r) => r.id)).toEqual(a.map((r) => r.id));
    expect(b[0].metadata).toEqual({ tag: "t" });
    expect(b[0].score).toBeCloseTo(a[0].score, 5);
  });
});
