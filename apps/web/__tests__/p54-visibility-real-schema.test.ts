/**
 * Property 54: visibility clauses are correct against the REAL production schema.
 *
 * The pure unit suite (p48) proves the SQL logic against a hand-built schema.
 * This integration suite closes the schema-drift gap: it runs the very same
 * clauses against tables cloned from the live `sayknowmind` database
 * (`CREATE TEMP TABLE ... LIKE public.<t> INCLUDING DEFAULTS`), so the exact
 * production column types (uuid ids, jsonb, varchar privacy_level) and defaults
 * are exercised.
 *
 * Safety: everything happens in session-private pg_temp tables that shadow the
 * real tables for this connection only and are dropped on disconnect. NO user
 * data is read or written. Skips automatically when DATABASE_URL is unset or
 * Postgres is unreachable, so `pnpm test` stays green without a database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  visibilityClause,
  readableClause,
  writableClause,
} from "@/lib/visibility";

const DB_URL = process.env.DATABASE_URL;
const CALLER = "user-A";
const ACTIVE_ORG = "org-team";
const OTHER_ORG = "org-other";
const TEAMMATE = "user-B";
const OUTSIDER = "user-C";

let client: Client | null = null;
const id: Record<string, string> = {};

interface Seed {
  label: string;
  user: string;
  org: string | null;
  privacy: "private" | "shared";
}
const SEEDS: Seed[] = [
  { label: "ownPrivate", user: CALLER, org: ACTIVE_ORG, privacy: "private" },
  { label: "ownShared", user: CALLER, org: ACTIVE_ORG, privacy: "shared" },
  { label: "ownNullOrg", user: CALLER, org: null, privacy: "private" },
  { label: "teamShared", user: TEAMMATE, org: ACTIVE_ORG, privacy: "shared" },
  { label: "teamPrivate", user: TEAMMATE, org: ACTIVE_ORG, privacy: "private" },
  { label: "otherOrg", user: OUTSIDER, org: OTHER_ORG, privacy: "shared" },
  { label: "aclView", user: TEAMMATE, org: ACTIVE_ORG, privacy: "private" },
  { label: "teamShareRow", user: OUTSIDER, org: OTHER_ORG, privacy: "private" },
];

beforeAll(async () => {
  if (!DB_URL) return;
  try {
    const c = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 2500 });
    await c.connect();
    client = c;
  } catch {
    client = null;
    return;
  }

  // Clone the real tables into session-private temp tables. Unqualified names in
  // the clauses resolve to pg_temp first, so the real tables are never touched.
  await client.query(`CREATE TEMP TABLE documents (LIKE public.documents INCLUDING DEFAULTS)`);
  await client.query(`CREATE TEMP TABLE resource_shares (LIKE public.resource_shares INCLUDING DEFAULTS)`);
  await client.query(`CREATE TEMP TABLE resource_team_shares (LIKE public.resource_team_shares INCLUDING DEFAULTS)`);

  for (const s of SEEDS) {
    const r = await client.query<{ id: string }>(
      `INSERT INTO documents (user_id, title, content, source_type, organization_id, privacy_level)
       VALUES ($1, 'T', '', 'note', $2, $3) RETURNING id`,
      [s.user, s.org, s.privacy],
    );
    id[s.label] = r.rows[0].id;
  }
  // ACL view-grant to the caller on a teammate's private doc.
  await client.query(
    `INSERT INTO resource_shares (resource_type, resource_id, grantee_user_id, granted_by, organization_id, permission)
     VALUES ('document', $1, $2, $3, $4, 'view')`,
    [id.aclView, CALLER, TEAMMATE, ACTIVE_ORG],
  );
  // Team-share an outsider's private doc into the caller's active org.
  await client.query(
    `INSERT INTO resource_team_shares (resource_type, resource_id, organization_id, granted_by)
     VALUES ('document', $1, $2, $3)`,
    [id.teamShareRow, ACTIVE_ORG, OUTSIDER],
  );
});

afterAll(async () => {
  if (client) await client.end();
});

async function idsWhere(whereSql: string): Promise<Set<string>> {
  const res = await client!.query<{ id: string }>(
    `SELECT id FROM documents d WHERE ${whereSql} ORDER BY id`,
    [ACTIVE_ORG, CALLER],
  );
  return new Set(res.rows.map((r) => r.id));
}

function labels(ids: Set<string>): Set<string> {
  const byId = new Map(Object.entries(id).map(([k, v]) => [v, k]));
  return new Set([...ids].map((x) => byId.get(x) ?? x));
}

describe("Property 54: visibility clauses vs real sayknowmind schema (temp-shadowed)", () => {
  const guard = (ctx: { skip: () => void }) => {
    if (!client) ctx.skip();
  };

  it("visibilityClause matches the documented golden set", (ctx) => {
    guard(ctx);
    return (async () => {
      const got = labels(await idsWhere(visibilityClause("d", 1, 2)));
      expect(got).toEqual(new Set(["ownPrivate", "ownShared", "ownNullOrg", "teamShared"]));
    })();
  });

  it("readableClause adds ACL + team shares, never a foreign private", (ctx) => {
    guard(ctx);
    return (async () => {
      const got = labels(await idsWhere(readableClause("d", 1, 2, "document")));
      expect(got).toEqual(
        new Set(["ownPrivate", "ownShared", "ownNullOrg", "teamShared", "aclView", "teamShareRow"]),
      );
      expect(got.has("teamPrivate")).toBe(false);
      expect(got.has("otherOrg")).toBe(false);
    })();
  });

  it("writableClause(non-admin) is the caller's own active-org rows", (ctx) => {
    guard(ctx);
    return (async () => {
      const got = labels(await idsWhere(writableClause("d", 1, 2, false)));
      expect(got).toEqual(new Set(["ownPrivate", "ownShared"]));
    })();
  });

  it("writableClause(admin) is every active-org row, no cross-org leak", (ctx) => {
    guard(ctx);
    return (async () => {
      const got = labels(await idsWhere(writableClause("d", 1, 2, true)));
      expect(got).toEqual(new Set(["ownPrivate", "ownShared", "teamShared", "teamPrivate", "aclView"]));
      expect(got.has("otherOrg")).toBe(false);
      expect(got.has("ownNullOrg")).toBe(false);
    })();
  });
});
