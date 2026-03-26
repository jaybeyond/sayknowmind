/**
 * zvec — Lightweight In-Process Vector Search Engine
 *
 * Provides fast approximate nearest-neighbor search using locality-sensitive
 * hashing (LSH). Designed to complement EdgeQuake's pgvector for hybrid
 * vector search with minimal memory footprint.
 *
 * Features:
 * - In-process (no external service)
 * - Cosine similarity via normalized dot product
 * - LSH index for sub-linear search
 * - Serializable index for persistence
 */

const DEFAULT_DIMENSIONS = 384;
const DEFAULT_NUM_TABLES = 8;
const DEFAULT_HASH_SIZE = 12;

export interface ZvecConfig {
  dimensions?: number;
  numTables?: number;
  hashSize?: number;
}

export interface VectorEntry {
  id: string;
  vector: Float32Array;
  metadata?: Record<string, unknown>;
}

export interface SearchResult {
  id: string;
  score: number;
  metadata?: Record<string, unknown>;
}

export class ZvecEngine {
  private dimensions: number;
  private numTables: number;
  private hashSize: number;
  private vectors: Map<string, VectorEntry> = new Map();
  private hashTables: Map<string, Set<string>>[];
  private hyperplanes: Float32Array[][];

  constructor(config: ZvecConfig = {}) {
    this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS;
    this.numTables = config.numTables ?? DEFAULT_NUM_TABLES;
    this.hashSize = config.hashSize ?? DEFAULT_HASH_SIZE;
    this.hashTables = [];
    this.hyperplanes = [];

    // Initialize LSH tables with random hyperplanes
    for (let t = 0; t < this.numTables; t++) {
      this.hashTables.push(new Map());
      const planes: Float32Array[] = [];
      for (let h = 0; h < this.hashSize; h++) {
        const plane = new Float32Array(this.dimensions);
        for (let d = 0; d < this.dimensions; d++) {
          // Box-Muller transform for normal distribution
          const u1 = Math.random();
          const u2 = Math.random();
          plane[d] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        }
        planes.push(plane);
      }
      this.hyperplanes.push(planes);
    }
  }

  /** Number of indexed vectors */
  get size(): number {
    return this.vectors.size;
  }

  /** Insert or update a vector */
  insert(id: string, vector: number[] | Float32Array, metadata?: Record<string, unknown>): void {
    const vec = vector instanceof Float32Array ? vector : new Float32Array(vector);
    if (vec.length !== this.dimensions) {
      throw new Error(`Vector dimension mismatch: expected ${this.dimensions}, got ${vec.length}`);
    }

    // Normalize for cosine similarity
    const normalized = this.normalize(vec);
    const entry: VectorEntry = { id, vector: normalized, metadata };

    // Remove old entry if exists
    this.remove(id);

    this.vectors.set(id, entry);

    // Index in all hash tables
    for (let t = 0; t < this.numTables; t++) {
      const hash = this.computeHash(normalized, t);
      if (!this.hashTables[t].has(hash)) {
        this.hashTables[t].set(hash, new Set());
      }
      this.hashTables[t].get(hash)!.add(id);
    }
  }

  /** Remove a vector by ID */
  remove(id: string): boolean {
    const entry = this.vectors.get(id);
    if (!entry) return false;

    for (let t = 0; t < this.numTables; t++) {
      const hash = this.computeHash(entry.vector, t);
      this.hashTables[t].get(hash)?.delete(id);
    }
    this.vectors.delete(id);
    return true;
  }

  /** Search for nearest neighbors */
  search(query: number[] | Float32Array, topK: number = 10): SearchResult[] {
    const qvec = query instanceof Float32Array ? query : new Float32Array(query);
    const normalized = this.normalize(qvec);

    // Collect candidates from all hash tables
    const candidates = new Set<string>();
    for (let t = 0; t < this.numTables; t++) {
      const hash = this.computeHash(normalized, t);
      const bucket = this.hashTables[t].get(hash);
      if (bucket) {
        for (const id of bucket) candidates.add(id);
      }
    }

    // If LSH returns too few candidates, fall back to brute force
    if (candidates.size < topK && this.vectors.size <= 10_000) {
      for (const id of this.vectors.keys()) candidates.add(id);
    }

    // Score candidates
    const results: SearchResult[] = [];
    for (const id of candidates) {
      const entry = this.vectors.get(id);
      if (!entry) continue;
      const score = this.dotProduct(normalized, entry.vector);
      results.push({ id, score, metadata: entry.metadata });
    }

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /** Brute-force exact search (for small datasets or verification) */
  exactSearch(query: number[] | Float32Array, topK: number = 10): SearchResult[] {
    const qvec = query instanceof Float32Array ? query : new Float32Array(query);
    const normalized = this.normalize(qvec);

    const results: SearchResult[] = [];
    for (const [id, entry] of this.vectors) {
      const score = this.dotProduct(normalized, entry.vector);
      results.push({ id, score, metadata: entry.metadata });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /** Serialize index to JSON for persistence */
  serialize(): string {
    const entries: Array<{ id: string; vector: number[]; metadata?: Record<string, unknown> }> = [];
    for (const [id, entry] of this.vectors) {
      entries.push({
        id,
        vector: Array.from(entry.vector),
        metadata: entry.metadata,
      });
    }
    return JSON.stringify({
      dimensions: this.dimensions,
      numTables: this.numTables,
      hashSize: this.hashSize,
      entries,
    });
  }

  /** Restore index from serialized JSON */
  static deserialize(json: string): ZvecEngine {
    const data = JSON.parse(json);
    const engine = new ZvecEngine({
      dimensions: data.dimensions,
      numTables: data.numTables,
      hashSize: data.hashSize,
    });
    for (const entry of data.entries) {
      engine.insert(entry.id, entry.vector, entry.metadata);
    }
    return engine;
  }

  // --- Internal helpers ---

  private normalize(vec: Float32Array): Float32Array {
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
    norm = Math.sqrt(norm);
    if (norm === 0) return vec;
    const result = new Float32Array(vec.length);
    for (let i = 0; i < vec.length; i++) result[i] = vec[i] / norm;
    return result;
  }

  private dotProduct(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
    return sum;
  }

  private computeHash(vec: Float32Array, tableIdx: number): string {
    const planes = this.hyperplanes[tableIdx];
    let hash = "";
    for (let h = 0; h < this.hashSize; h++) {
      const dot = this.dotProduct(vec, planes[h]);
      hash += dot >= 0 ? "1" : "0";
    }
    return hash;
  }
}
