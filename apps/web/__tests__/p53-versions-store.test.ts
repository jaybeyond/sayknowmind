/**
 * Property 53: Document version capture is throttled, de-duped, and bounded.
 *
 * `lib/versions/store.ts` checkpoints every editable surface (notes/sheets/
 * mindmaps) through one capture point. It must NOT (a) record a version when
 * nothing changed, (b) spam versions inside the throttle window, or (c) grow
 * the table without bound. Verified against a real embedded Postgres (PGlite)
 * via the injectable `db` adapter.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { captureDocumentVersion } from "@/lib/versions/store";
import type { Queryable } from "@/lib/tags/store";

let pg: PGlite;
let db: Queryable;

beforeAll(async () => {
  pg = new PGlite();
  await pg.waitReady;
  await pg.exec(`
    CREATE TABLE documents (
      id text PRIMARY KEY,
      title text,
      content text,
      metadata text
    );
    CREATE TABLE document_versions (
      id bigserial PRIMARY KEY,
      document_id text NOT NULL,
      title text,
      content text,
      metadata text,
      created_by text,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
  `);
  // clock_timestamp() advances within a transaction, giving distinct ordering
  // for the rapid inserts this suite makes (NOW() would tie them).
  db = {
    query: (async (text: string, values?: unknown[]) => {
      const r = await pg.query(text, values as unknown[]);
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length } as never;
    }) as Queryable["query"],
  };
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec(`TRUNCATE documents; TRUNCATE document_versions RESTART IDENTITY;`);
});

async function setDoc(id: string, title: string, content: string): Promise<void> {
  await pg.query(
    `INSERT INTO documents (id, title, content) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content`,
    [id, title, content],
  );
}

async function versionCount(id: string): Promise<number> {
  const r = await pg.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM document_versions WHERE document_id = $1`, [id]);
  return Number(r.rows[0].n);
}

describe("Property 53: captureDocumentVersion", () => {
  it("captures the first version and attributes it to the author", async () => {
    await setDoc("d1", "Title", "Hello");
    const vid = await captureDocumentVersion("d1", "user-A", { db });
    expect(vid).not.toBeNull();
    expect(await versionCount("d1")).toBe(1);
    const r = await pg.query<{ created_by: string; content: string }>(
      `SELECT created_by, content FROM document_versions WHERE document_id = 'd1'`,
    );
    expect(r.rows[0].created_by).toBe("user-A");
    expect(r.rows[0].content).toBe("Hello");
  });

  it("returns null when the document does not exist", async () => {
    expect(await captureDocumentVersion("ghost", "user-A", { db })).toBeNull();
    expect(await versionCount("ghost")).toBe(0);
  });

  it("de-dupes: an unchanged document is not re-versioned (even with force)", async () => {
    await setDoc("d1", "T", "same");
    expect(await captureDocumentVersion("d1", "u", { db, force: true })).not.toBeNull();
    expect(await captureDocumentVersion("d1", "u", { db, force: true })).toBeNull();
    expect(await versionCount("d1")).toBe(1);
  });

  it("captures a new version when content actually changes", async () => {
    await setDoc("d1", "T", "v1");
    await captureDocumentVersion("d1", "u", { db, force: true });
    await setDoc("d1", "T", "v2");
    expect(await captureDocumentVersion("d1", "u", { db, force: true })).not.toBeNull();
    expect(await versionCount("d1")).toBe(2);
  });

  it("throttles: a non-forced capture inside the window is skipped even if content changed", async () => {
    await setDoc("d1", "T", "v1");
    await captureDocumentVersion("d1", "u", { db, force: true });
    await setDoc("d1", "T", "v2");
    // within 30s window, no force → throttled
    expect(await captureDocumentVersion("d1", "u", { db })).toBeNull();
    expect(await versionCount("d1")).toBe(1);
    // force bypasses the throttle
    expect(await captureDocumentVersion("d1", "u", { db, force: true })).not.toBeNull();
    expect(await versionCount("d1")).toBe(2);
  });

  it("retains at most 50 versions per document (oldest pruned)", async () => {
    await setDoc("d1", "T", "start");
    for (let i = 0; i < 60; i++) {
      await setDoc("d1", "T", `content-${i}`);
      await captureDocumentVersion("d1", "u", { db, force: true });
    }
    expect(await versionCount("d1")).toBe(50);
    // the newest content must survive pruning
    const r = await pg.query<{ content: string }>(
      `SELECT content FROM document_versions WHERE document_id = 'd1' ORDER BY created_at DESC LIMIT 1`,
    );
    expect(r.rows[0].content).toBe("content-59");
  });
});
