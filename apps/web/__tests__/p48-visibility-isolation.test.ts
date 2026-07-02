/**
 * Property 48: Multi-tenant visibility/isolation SQL is provably correct.
 *
 * `lib/visibility.ts` is the single most security-critical module in the web
 * app: 38+ API routes compose its clauses into the WHERE of every read/write
 * against documents and categories. A bug here leaks one tenant's private data
 * to another. Until now it had ZERO dedicated tests.
 *
 * This suite does NOT just eyeball the emitted strings. It runs the generated
 * SQL against a real (embedded) PostgreSQL engine (PGlite) and asserts the
 * isolation invariants hold, then differential-tests each clause against an
 * independent JS oracle over randomized universes of rows and shares. If the
 * SQL and the oracle ever disagree, the test fails with the counterexample.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { PGlite } from "@electric-sql/pglite";
import {
  visibilityClause,
  orgScopeClause,
  writableClause,
  sharedWithClause,
  readableClause,
  teamSharedClause,
  editableViaShareClause,
  type ShareableResource,
} from "@/lib/visibility";

// ── Fixtures ────────────────────────────────────────────────────────────────
// Caller identity used by every clause. params order is always [org, user] so
// orgParam=$1, userParam=$2 across the suite.
const CALLER = "user-A";
const ACTIVE_ORG = "org-team";
const OTHER_ORG = "org-other";
const TEAMMATE = "user-B";
const OUTSIDER = "user-C";

type Privacy = "private" | "shared";
interface DocRow {
  id: string;
  user_id: string;
  organization_id: string | null;
  privacy_level: Privacy;
}
interface ShareRow {
  resource_type: ShareableResource;
  resource_id: string;
  grantee_user_id: string;
  permission: "view" | "edit";
}
interface TeamShareRow {
  resource_type: ShareableResource;
  resource_id: string;
  organization_id: string;
}

let db: PGlite;

beforeAll(async () => {
  db = new PGlite(); // in-memory
  await db.waitReady;
  await db.exec(`
    CREATE TABLE documents (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      organization_id text,
      privacy_level text NOT NULL DEFAULT 'private'
    );
    CREATE TABLE categories (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      organization_id text,
      privacy_level text NOT NULL DEFAULT 'private'
    );
    CREATE TABLE resource_shares (
      resource_type text NOT NULL,
      resource_id text NOT NULL,
      grantee_user_id text NOT NULL,
      permission text NOT NULL DEFAULT 'view'
    );
    CREATE TABLE resource_team_shares (
      resource_type text NOT NULL,
      resource_id text NOT NULL,
      organization_id text NOT NULL
    );
  `);
});

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.exec(`TRUNCATE documents, categories, resource_shares, resource_team_shares;`);
});

async function seed(
  docs: DocRow[],
  shares: ShareRow[] = [],
  teamShares: TeamShareRow[] = [],
): Promise<void> {
  for (const d of docs) {
    await db.query(
      `INSERT INTO documents (id, user_id, organization_id, privacy_level) VALUES ($1,$2,$3,$4)`,
      [d.id, d.user_id, d.organization_id, d.privacy_level],
    );
  }
  for (const s of shares) {
    await db.query(
      `INSERT INTO resource_shares (resource_type, resource_id, grantee_user_id, permission) VALUES ($1,$2,$3,$4)`,
      [s.resource_type, s.resource_id, s.grantee_user_id, s.permission],
    );
  }
  for (const t of teamShares) {
    await db.query(
      `INSERT INTO resource_team_shares (resource_type, resource_id, organization_id) VALUES ($1,$2,$3)`,
      [t.resource_type, t.resource_id, t.organization_id],
    );
  }
}

async function idsWhere(whereSql: string, params: unknown[] = [ACTIVE_ORG, CALLER]): Promise<Set<string>> {
  // Bind exactly the params the clause references. A single clause run in
  // isolation must not bind an unreferenced placeholder, or PostgreSQL rejects
  // the prepared statement with 42P18 (indeterminate_datatype) / wrong arity —
  // the same constraint the production writableClause anchors around.
  const res = await db.query<{ id: string }>(
    `SELECT id FROM documents d WHERE ${whereSql} ORDER BY id`,
    params,
  );
  return new Set(res.rows.map((r) => r.id));
}

// ── JS reference oracle (independent reimplementation of the documented rules) ─
const oracle = {
  visible(d: DocRow): boolean {
    return d.user_id === CALLER || (d.organization_id === ACTIVE_ORG && d.privacy_level !== "private");
  },
  shared(d: DocRow, type: ShareableResource, shares: ShareRow[]): boolean {
    return shares.some((s) => s.resource_type === type && s.resource_id === d.id && s.grantee_user_id === CALLER);
  },
  teamShared(d: DocRow, type: ShareableResource, team: TeamShareRow[]): boolean {
    return team.some((t) => t.resource_type === type && t.resource_id === d.id && t.organization_id === ACTIVE_ORG);
  },
  readable(d: DocRow, type: ShareableResource, shares: ShareRow[], team: TeamShareRow[]): boolean {
    return this.visible(d) || this.shared(d, type, shares) || this.teamShared(d, type, team);
  },
  writable(d: DocRow, isAdmin: boolean): boolean {
    return isAdmin ? d.organization_id === ACTIVE_ORG : d.organization_id === ACTIVE_ORG && d.user_id === CALLER;
  },
  editableViaShare(d: DocRow, type: ShareableResource, shares: ShareRow[]): boolean {
    return shares.some(
      (s) => s.resource_type === type && s.resource_id === d.id && s.grantee_user_id === CALLER && s.permission === "edit",
    );
  },
  orgScope(d: DocRow): boolean {
    return d.organization_id === ACTIVE_ORG;
  },
};

function expected(docs: DocRow[], pred: (d: DocRow) => boolean): Set<string> {
  return new Set(docs.filter(pred).map((d) => d.id));
}

// ── Golden integration cases against real SQL ────────────────────────────────
describe("Property 48: visibility clauses enforce tenant isolation (real SQL)", () => {
  const docs: DocRow[] = [
    { id: "own-private", user_id: CALLER, organization_id: ACTIVE_ORG, privacy_level: "private" },
    { id: "own-shared", user_id: CALLER, organization_id: ACTIVE_ORG, privacy_level: "shared" },
    { id: "own-legacy-nullorg", user_id: CALLER, organization_id: null, privacy_level: "private" },
    { id: "own-other-org", user_id: CALLER, organization_id: OTHER_ORG, privacy_level: "private" },
    { id: "team-shared", user_id: TEAMMATE, organization_id: ACTIVE_ORG, privacy_level: "shared" },
    { id: "team-private", user_id: TEAMMATE, organization_id: ACTIVE_ORG, privacy_level: "private" },
    { id: "other-org-shared", user_id: OUTSIDER, organization_id: OTHER_ORG, privacy_level: "shared" },
    { id: "acl-view", user_id: TEAMMATE, organization_id: ACTIVE_ORG, privacy_level: "private" },
    { id: "acl-edit", user_id: TEAMMATE, organization_id: ACTIVE_ORG, privacy_level: "private" },
    { id: "team-share-row", user_id: OUTSIDER, organization_id: OTHER_ORG, privacy_level: "private" },
  ];
  const shares: ShareRow[] = [
    { resource_type: "document", resource_id: "acl-view", grantee_user_id: CALLER, permission: "view" },
    { resource_type: "document", resource_id: "acl-edit", grantee_user_id: CALLER, permission: "edit" },
    // a share for the WRONG user must never grant the caller access
    { resource_type: "document", resource_id: "team-private", grantee_user_id: OUTSIDER, permission: "edit" },
  ];
  const teamShares: TeamShareRow[] = [
    { resource_type: "document", resource_id: "team-share-row", organization_id: ACTIVE_ORG },
    // a team share for a DIFFERENT org must never grant the caller access
    { resource_type: "document", resource_id: "own-other-org", organization_id: OTHER_ORG },
  ];

  beforeEach(() => seed(docs, shares, teamShares));

  it("visibilityClause: own rows always visible, foreign private hidden, org-shared visible", async () => {
    const got = await idsWhere(visibilityClause("d", 1, 2));
    expect(got).toEqual(
      new Set(["own-private", "own-shared", "own-legacy-nullorg", "own-other-org", "team-shared"]),
    );
  });

  it("readableClause: visibility + per-user ACL + team share, never foreign private", async () => {
    const got = await idsWhere(readableClause("d", 1, 2, "document"));
    expect(got).toEqual(
      new Set([
        "own-private",
        "own-shared",
        "own-legacy-nullorg",
        "own-other-org",
        "team-shared",
        "acl-view",
        "acl-edit",
        "team-share-row",
      ]),
    );
    // The teammate's private doc was shared with the OUTSIDER, not the caller.
    expect(got.has("team-private")).toBe(false);
  });

  it("writableClause(non-admin): only the caller's own rows in the active org", async () => {
    const got = await idsWhere(writableClause("d", 1, 2, false));
    expect(got).toEqual(new Set(["own-private", "own-shared"]));
  });

  it("writableClause(admin): every row in the active org regardless of owner", async () => {
    const got = await idsWhere(writableClause("d", 1, 2, true));
    expect(got).toEqual(
      new Set(["own-private", "own-shared", "team-shared", "team-private", "acl-view", "acl-edit"]),
    );
    // never leaks write to other orgs or NULL-org rows
    expect(got.has("other-org-shared")).toBe(false);
    expect(got.has("own-legacy-nullorg")).toBe(false);
  });

  it("sharedWithClause: only rows explicitly shared with the caller", async () => {
    const got = await idsWhere(sharedWithClause("d", 1, "document"), [CALLER]);
    expect(got).toEqual(new Set(["acl-view", "acl-edit"]));
  });

  it("editableViaShareClause: only rows shared with 'edit' permission", async () => {
    const got = await idsWhere(editableViaShareClause("d", 1, "document"), [CALLER]);
    expect(got).toEqual(new Set(["acl-edit"]));
  });

  it("teamSharedClause: only rows shared into the caller's active org", async () => {
    const got = await idsWhere(teamSharedClause("d", 1, "document"), [ACTIVE_ORG]);
    expect(got).toEqual(new Set(["team-share-row"]));
  });

  it("orgScopeClause: every row whose organization_id is the active org", async () => {
    const got = await idsWhere(orgScopeClause("d", 1), [ACTIVE_ORG]);
    expect(got).toEqual(
      new Set(["own-private", "own-shared", "team-shared", "team-private", "acl-view", "acl-edit"]),
    );
  });

  it("resource_type is honoured: a 'category' share never unlocks a 'document' read", async () => {
    await db.exec(`TRUNCATE resource_shares;`);
    await db.query(
      `INSERT INTO resource_shares (resource_type, resource_id, grantee_user_id, permission) VALUES ('category','acl-view',$1,'edit')`,
      [CALLER],
    );
    const got = await idsWhere(readableClause("d", 1, 2, "document"));
    expect(got.has("acl-view")).toBe(false);
  });
});

// ── Differential property tests: SQL must equal the JS oracle on random data ──
describe("Property 48: clauses match an independent oracle over random universes", () => {
  const arbDoc = (id: string): fc.Arbitrary<DocRow> =>
    fc.record({
      id: fc.constant(id),
      user_id: fc.constantFrom(CALLER, TEAMMATE, OUTSIDER),
      organization_id: fc.constantFrom(ACTIVE_ORG, OTHER_ORG, null),
      privacy_level: fc.constantFrom<Privacy>("private", "shared"),
    });

  const arbUniverse = fc
    .integer({ min: 1, max: 10 })
    .chain((n) => {
      const ids = Array.from({ length: n }, (_, i) => `d${i}`);
      const docs = fc.tuple(...ids.map(arbDoc));
      const shares = fc.array(
        fc.record({
          resource_type: fc.constantFrom<ShareableResource>("document", "category"),
          resource_id: fc.constantFrom(...ids),
          grantee_user_id: fc.constantFrom(CALLER, TEAMMATE, OUTSIDER),
          permission: fc.constantFrom<"view" | "edit">("view", "edit"),
        }),
        { maxLength: 6 },
      );
      const teamShares = fc.array(
        fc.record({
          resource_type: fc.constantFrom<ShareableResource>("document", "category"),
          resource_id: fc.constantFrom(...ids),
          organization_id: fc.constantFrom(ACTIVE_ORG, OTHER_ORG),
        }),
        { maxLength: 4 },
      );
      return fc.tuple(docs, shares, teamShares);
    });

  it("readableClause('document') == oracle.readable for all random universes", async () => {
    await fc.assert(
      fc.asyncProperty(arbUniverse, async ([docs, shares, teamShares]) => {
        await db.exec(`TRUNCATE documents, resource_shares, resource_team_shares;`);
        await seed(docs as DocRow[], shares as ShareRow[], teamShares as TeamShareRow[]);
        const sql = await idsWhere(readableClause("d", 1, 2, "document"));
        const ref = expected(docs as DocRow[], (d) =>
          oracle.readable(d, "document", shares as ShareRow[], teamShares as TeamShareRow[]),
        );
        expect(sql).toEqual(ref);
      }),
      { numRuns: 40 },
    );
  });

  it("writableClause(admin & non-admin) == oracle.writable for all random universes", async () => {
    await fc.assert(
      fc.asyncProperty(arbUniverse, fc.boolean(), async ([docs], isAdmin) => {
        await db.exec(`TRUNCATE documents, resource_shares, resource_team_shares;`);
        await seed(docs as DocRow[]);
        const sql = await idsWhere(writableClause("d", 1, 2, isAdmin));
        const ref = expected(docs as DocRow[], (d) => oracle.writable(d, isAdmin));
        expect(sql).toEqual(ref);
      }),
      { numRuns: 40 },
    );
  });

  it("CRITICAL: a foreign, unshared private row is NEVER readable", async () => {
    await fc.assert(
      fc.asyncProperty(arbUniverse, async ([docs, shares, teamShares]) => {
        await db.exec(`TRUNCATE documents, resource_shares, resource_team_shares;`);
        await seed(docs as DocRow[], shares as ShareRow[], teamShares as TeamShareRow[]);
        const sql = await idsWhere(readableClause("d", 1, 2, "document"));
        for (const d of docs as DocRow[]) {
          const foreignPrivate =
            d.user_id !== CALLER &&
            d.privacy_level === "private" &&
            !oracle.shared(d, "document", shares as ShareRow[]) &&
            !oracle.teamShared(d, "document", teamShares as TeamShareRow[]);
          if (foreignPrivate) {
            expect(sql.has(d.id)).toBe(false);
          }
        }
      }),
      { numRuns: 60 },
    );
  });
});

// ── Structural / injection-surface checks ────────────────────────────────────
describe("Property 48: clauses are parameterized and resource-type safe", () => {
  it("never inlines caller values; always uses positional placeholders", () => {
    const clauses = [
      visibilityClause("d", 1, 2),
      orgScopeClause("d", 1),
      writableClause("d", 1, 2, false),
      writableClause("d", 1, 2, true),
      sharedWithClause("d", 2, "document"),
      readableClause("d", 1, 2, "document"),
      teamSharedClause("d", 1, "document"),
      editableViaShareClause("d", 2, "document"),
    ];
    for (const c of clauses) {
      expect(c).toMatch(/\$\d/); // contains at least one positional param
      expect(c).not.toContain(CALLER); // never the literal caller id
      expect(c).not.toContain(ACTIVE_ORG); // never the literal org id
    }
  });

  it("resource type appears only as the exact whitelisted literal", () => {
    for (const type of ["document", "category"] as ShareableResource[]) {
      const c = readableClause("d", 1, 2, type);
      expect(c).toContain(`'${type}'`);
      const other = type === "document" ? "category" : "document";
      expect(c).not.toContain(`'${other}'`);
    }
  });
});
