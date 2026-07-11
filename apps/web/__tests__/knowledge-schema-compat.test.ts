import { beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ pool: { query: mocks.query } }));

beforeEach(() => {
  vi.resetModules();
  mocks.query.mockReset();
  mocks.query.mockResolvedValue({ rows: [] });
});

describe("knowledge schema compatibility guard", () => {
  it("applies each additive schema group once under concurrent callers", async () => {
    const schema = await import("@/lib/schema-compat");

    await Promise.all([
      schema.ensureKnowledgeSchema(),
      schema.ensureKnowledgeSchema(),
      schema.ensureSharedContentSchema(),
    ]);

    expect(mocks.query).toHaveBeenCalledTimes(2);
    const sql = mocks.query.mock.calls.map(([statement]) => String(statement)).join("\n");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS share_token");
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_shared_content_share_token");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS resource_shares");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS resource_team_shares");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS kind");
  });

  it("clears a failed cache entry so the next request can retry", async () => {
    mocks.query.mockRejectedValueOnce(new Error("temporary DDL lock"));
    const schema = await import("@/lib/schema-compat");

    await expect(schema.ensureSharedContentSchema()).rejects.toThrow("temporary DDL lock");

    mocks.query.mockResolvedValueOnce({ rows: [] });
    await expect(schema.ensureSharedContentSchema()).resolves.toBeUndefined();
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it("upgrades the minimal legacy knowledge schema in PostgreSQL", async () => {
    const db = new PGlite();
    await db.waitReady;
    try {
      await db.exec(`
        CREATE TABLE "user" (id TEXT PRIMARY KEY);
        CREATE TABLE organization (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE);
        CREATE TABLE documents (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id TEXT NOT NULL REFERENCES "user"(id)
        );
        CREATE TABLE categories (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id TEXT NOT NULL REFERENCES "user"(id)
        );
        CREATE TABLE shared_content (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id TEXT NOT NULL REFERENCES "user"(id)
        );
        INSERT INTO "user" (id) VALUES ('user-1');
        INSERT INTO organization (id, slug) VALUES ('org-1', 'personal-user-1');
        INSERT INTO documents (user_id) VALUES ('user-1');
        INSERT INTO categories (user_id) VALUES ('user-1');
        INSERT INTO shared_content (user_id) VALUES ('user-1');
      `);
      mocks.query.mockImplementation(async (statement: string) => {
        await db.exec(statement);
        return { rows: [] };
      });
      const schema = await import("@/lib/schema-compat");

      await schema.ensureKnowledgeSchema();

      const tables = await db.query<{ table_name: string }>(`
        SELECT table_name FROM information_schema.tables
         WHERE table_name IN ('resource_shares', 'resource_team_shares')
         ORDER BY table_name
      `);
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        "resource_shares",
        "resource_team_shares",
      ]);

      const shared = await db.query<{ share_token: string; organization_id: string }>(
        "SELECT share_token, organization_id FROM shared_content",
      );
      expect(shared.rows[0].share_token).toHaveLength(32);
      expect(shared.rows[0].organization_id).toBe("org-1");

      const shareTokenColumn = await db.query<{ character_maximum_length: number }>(`
        SELECT character_maximum_length
          FROM information_schema.columns
         WHERE table_name = 'shared_content' AND column_name = 'share_token'
      `);
      expect(Number(shareTokenColumn.rows[0].character_maximum_length)).toBe(32);

      const category = await db.query<{ kind: string; privacy_level: string; organization_id: string }>(
        "SELECT kind, privacy_level, organization_id FROM categories",
      );
      expect(category.rows[0]).toMatchObject({
        kind: "collection",
        privacy_level: "private",
        organization_id: "org-1",
      });
    } finally {
      await db.close();
    }
  });
});
