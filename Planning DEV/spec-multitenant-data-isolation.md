# Spec: Multi-tenant data isolation (own + shared)

**Status:** Draft · 2026-05-13
**Owner:** TBD
**Touches:** `apps/web/app/api/**`, `packages/mcp-server/**`, `db/migrations/**`, EdgeQuake indexing

---

## 1. Goal

Every user can see:

1. **their own data** — documents, categories, conversations, tags they created
2. **content other users explicitly marked shared** — `privacy_level = 'shared'` rows

…and nothing else. This rule must hold across every surface:

* Web app (`sayknowmind.ypai.click` UI + `/api/*` routes)
* MCP server (Claude Desktop / Cursor / IDE clients)
* Telegram bot
* Any future SDK / integration

Identity at every surface resolves to a single canonical `userId` from the `"user"` (better-auth) table.

---

## 2. Non-goals (this spec)

* Group / team / org sharing — only `private` vs `shared` for now.
* Cross-user write or comment — sharing is read-only.
* Sharing visibility between two specific users (i.e. ACLs) — `shared` is "anyone authenticated".
* Encrypted multi-tenant EdgeQuake workspaces — covered as a follow-up.

---

## 3. Current state (gap analysis)

### Data model — already correct

* `documents.user_id TEXT NOT NULL REFERENCES "user"(id)` (`db/init/04-sayknowmind-init.sql`)
* `documents.privacy_level VARCHAR(10) IN ('private', 'shared')` default `'private'` (`db/init/06-privacy-levels.sql`)
* `categories` mirror the same pattern.
* `user_mcp_keys (user_id PK, api_key UNIQUE)` exists (`db/migrations/041_user_mcp_keys.sql`).

### Surfaces — partial

| Surface | userId source | Data filter today |
|---|---|---|
| Web `/api/search` | better-auth cookie via `getUserIdFromRequest()` | `WHERE d.user_id = me` (private-only, no shared) |
| Web `/api/documents` | same | same |
| Web `/api/chat` (RAG pipeline) | same | searchKnowledge uses user_id |
| Web `/api/categories` / `/api/knowledge/*` | same | `WHERE user_id = me` (private-only, no shared) |
| MCP `sayknowmind_search` (proxies cloud) | `AUTH_SECRET` shared bearer | ⛔ no user context forwarded |
| MCP `query` / `document_*` / `graph_*` (EdgeQuake SDK direct) | none — uses global tenant/workspace | ⛔ all users see all data |
| Telegram webhook | `channel_links.user_id` lookup | uses user_id |

### Auth gateway

`apps/web/lib/ingest/session-helper.ts` `getUserIdFromRequest()` only checks the better-auth session cookie. No MCP-key fallback.

`packages/mcp-server/src/index.ts` (this PR) already validates MCP keys against `user_mcp_keys` and attaches `req.userId`, but tool handlers don't have a way to read that value.

---

## 4. Visibility rule (canonical)

For any resource scoped to a user, the query layer should expand:

```
visible_to(me) := (resource.user_id = me) OR (resource.privacy_level = 'shared')
```

Mutations stay private:

```
writable_by(me) := (resource.user_id = me)
```

`shared` access is **read-only**.

Recommendation: centralize this in one helper per layer (`lib/visibility.ts` for cloud, `with_user_filter()` for raw SQL builders, EdgeQuake metadata filter for graph queries) so no route hand-rolls the WHERE clause. The helper must accept a SQL table alias because current routes use multiple aliases (`d`, `documents`, `c`, `categories`, etc.).

---

## 5. Identity layer (cloud)

Refactor `getUserIdFromRequest()` to accept any of these proofs, in order:

1. **Better-auth session cookie** (current path — browser, desktop webview).
2. **`Authorization: Bearer sk-mcp-<hex>`** — look up in `user_mcp_keys`. Used by MCP server and any IDE/CLI client.
3. **Telegram-linked path** stays as-is in the webhook handler (uses `channel_links` directly).

Returns `null` if no source matches. All API routes already check for `null` and 401, so no caller changes needed beyond the helper.

**Why MCP key alone is enough:** the key is server-issued, stored hashed-or-encrypted (TBD — currently plaintext), 64 chars random, revocable per user. Equivalent trust level to a session cookie.

**Security upgrade (recommended, separate task):** store keys hashed (`bcrypt` or `argon2`), match on hash. Then `user_mcp_keys.api_key` becomes a hash, not the secret itself.

---

## 6. Cloud-side query updates

Every API route that currently does `WHERE user_id = $1` for read operations on documents/categories/knowledge projections must become:

```sql
WHERE (resource.user_id = $1 OR resource.privacy_level = 'shared')
```

Routes affected (read paths only — list, search, get-by-id, related, recent, gallery):

* `apps/web/app/api/search/route.ts` — keyword + filtered search + EdgeQuake source enrichment
* `apps/web/app/api/documents/route.ts` — list
* `apps/web/app/api/documents/[id]/route.ts` — single document GET (PATCH/DELETE still private)
* `apps/web/app/api/documents/[id]/related/route.ts` — related-document reads
* `apps/web/lib/agents/pipeline.ts::searchKnowledge` — RAG retrieval + catalog fallback
* `apps/web/app/api/categories/route.ts` and `apps/web/lib/categories/store.ts` — category read/list paths
* `apps/web/app/api/categories/[id]/documents/route.ts` — document reads under a category
* `apps/web/app/api/knowledge/graph/route.ts` and `apps/web/app/api/knowledge/node/[nodeId]/route.ts` — graph/node reads
* `apps/web/app/api/share/gallery/route.ts` — already shared-only, audit to preserve that invariant
* Telegram inline search (`/api/integrations/telegram/webhook/route.ts` — search-by-message path)

Helper:

```ts
// lib/visibility.ts
export function visibilityClause(alias: string, userIdParam: number): string {
  return `(${alias}.user_id = $${userIdParam} OR ${alias}.privacy_level = 'shared')`;
}

export function writableClause(alias: string, userIdParam: number): string {
  return `${alias}.user_id = $${userIdParam}`;
}
```

Each route swaps its existing read-path `alias.user_id = $N` for `visibilityClause(alias, N)`. Write paths keep `writableClause(alias, N)` or their existing strict owner check.

**Test coverage:** at least one integration test per route asserting:
1. user A sees their private doc
2. user A sees user B's shared doc
3. user A does **not** see user B's private doc
4. user A can list `categories` of theirs but not modify B's shared category

---

## 7. MCP server changes

### 7.1 Per-request context propagation

`McpServer.tool()` handlers receive `params` only — no `req` access. Solve with `AsyncLocalStorage`:

```ts
// auth-context.ts
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  userId: string | null;        // null = admin/legacy shared key path
  rawToken: string;             // pass-through for cloud API forwarding
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
```

`authMiddleware`:

```ts
requestContext.run({ userId, rawToken: token }, () => next());
```

Tool handlers read via `requestContext.getStore()`.

### 7.2 `sayknowmind_*` tools → forward identity

These tools proxy to cloud APIs. Change the `Authorization` header from `AUTH_SECRET` to the user's `rawToken`:

```ts
const ctx = requestContext.getStore();
const headers = { "Content-Type": "application/json" };
if (ctx?.rawToken) headers.Authorization = `Bearer ${ctx.rawToken}`;
fetch(`${WEB_APP_URL}/api/search`, { headers, ... });
```

Cloud `getUserIdFromRequest()` (after §5 refactor) resolves the token → userId → user-scoped query result. **No further per-route work needed for these tools** once §5+§6 are in place.

### 7.3 EdgeQuake-direct tools — gating

`document_*`, `query`, `graph_*` currently use one global EdgeQuake workspace. Without a per-user filter at the EdgeQuake layer, these leak data.

Three options, ranked by effort:

| Option | Effort | Isolation quality |
|---|---|---|
| **A. Disable in production** until phase 3 lands | minutes | perfect (tools just unavailable) |
| **B. Post-filter** — run the EdgeQuake query, then strip references whose `source_document_id` doesn't pass §6's visibility rule (via a Postgres lookup) | half-day | leaks entity *names* but not document content |
| **C. EdgeQuake per-user workspace** — every user gets their own workspace; ingestion writes there; queries scope there | week-scale + re-ingestion of existing docs | perfect |

**Decision for this iteration:** Option A. Direct EdgeQuake tools refuse with `403 user_isolation_unimplemented` when `requestContext.userId` is non-null (admin override stays unrestricted). `sayknowmind_search` covers the user-facing search need in the meantime.

Phase 3 lands Option C — see §10.

---

## 8. EdgeQuake ingestion contract (forward-compatible)

To make Phase 3 cheaper, every EdgeQuake upload must carry `metadata.user_id`, even though queries don't filter on it yet:

* The main ingestion job already passes `metadata: { language, user_id: userId }` before `indexDocument()`.
* `syncUnindexedToEdgeQuake()` also passes `user_id`.
* Audit all remaining `indexDocument()` callers and enforce the invariant in `apps/web/lib/edgequake/client.ts` when a `document_id` belongs to a known user.
* Once Phase 3 query-side filter exists, we avoid a full re-ingest for documents that were indexed after this invariant shipped.

This is forward-compatible and harmless if Phase 3 slips.

---

## 9. Migration / rollout plan

### Phase 1 — Identity unification (1 PR, ~2 h)

* §5: extend `getUserIdFromRequest()` with MCP-key path.
* §7.1: AsyncLocalStorage context in MCP server.
* §7.2: `sayknowmind_*` tools forward `rawToken`.
* §7.3 Option A: EdgeQuake-direct tools gated.

Outcome: every authenticated path knows its user.

### Phase 2 — Visibility rule everywhere (1 PR, ~2 h)

* §6: `lib/visibility.ts` helper + swap WHERE clauses in every listed read route, including categories and knowledge graph projections.
* §8: audit/enforce EdgeQuake uploads with `metadata.user_id`.
* Integration tests for the 4-case matrix per route.

Outcome: web search + MCP `sayknowmind_*` see own + shared correctly.

### Phase 3 — EdgeQuake per-user workspaces (separate spec)

Out of scope for now. Open questions:

* One workspace per user (millions of empty workspaces?) vs single workspace + metadata filter?
* Re-ingest existing docs into per-user workspace, or virtualize via metadata-only filter?
* SDK support for metadata `WHERE` clause in `query.execute`?
* Cost / latency of N×workspaces in EdgeQuake?

---

## 10. Security considerations

* **Plaintext MCP keys**: `user_mcp_keys.api_key` stores the secret in plaintext. A DB read leak exposes all MCP keys. Follow-up: hash with bcrypt and compare with `bcrypt.compare` at lookup. Existing keys rotate on first re-issue.
* **Admin override key (`MCP_API_KEY`)**: bypasses user context. Currently configured in production for debugging. Once Phase 1 ships and per-user keys work end-to-end, remove from production `.env`. Keep only for local dev / one-shot ops.
* **Privilege escalation via state**: not applicable here — sharing is one-way (mark your own doc shared; can't escalate someone else's).
* **Audit log**: log `userId, tool, params_summary` on every MCP tool invocation. Helps detect anomalous read patterns.

---

## 11. Acceptance criteria

A user is correctly isolated iff, for two test users A and B with `A_private`, `A_shared`, `B_private`, `B_shared` documents:

| Surface | A_private | A_shared | B_private | B_shared |
|---|---|---|---|---|
| A's web search | ✓ | ✓ | ✗ | ✓ |
| A's `/api/documents` list | ✓ | ✓ | ✗ | ✓ |
| A's `/api/categories` list | ✓ | ✓ | ✗ | ✓ |
| A's `/api/knowledge/graph` projections | ✓ | ✓ | ✗ | ✓ |
| A's MCP `sayknowmind_search` | ✓ | ✓ | ✗ | ✓ |
| A's MCP `query` (EdgeQuake direct, Phase 1) | 403 | 403 | 403 | 403 |
| A's GET `/api/documents/B_private` | n/a | n/a | 404 | n/a |
| A's PATCH `/api/documents/B_shared` | n/a | n/a | n/a | 403 |
| B's same set of operations | ✗ | ✓ | ✓ | ✓ |

Integration test suite at `apps/web/__tests__/multitenant-isolation.test.ts` (new file) covers each row.

---

## 12. Open questions

1. Category UX: `categories` follow the same visibility rule for reads, but shared categories appearing in a user's sidebar may need visual ownership labels.
2. Should `conversations` ever be shareable? (Probably not — keep private.)
3. Tag visibility — shared docs' tags appear in the tag picker even if you didn't author them?
4. Quota: does a shared doc count against the sharer's storage only, or against every reader?
5. Revocation lag — when a user flips a doc from `shared → private`, how fast must read access stop? (Recommend: next query; no caching.)

---

## Appendix A — files touched in Phase 1

```
apps/web/lib/ingest/session-helper.ts        (add MCP-key path)
packages/mcp-server/src/auth-context.ts      (new)
packages/mcp-server/src/index.ts             (wire AsyncLocalStorage in authMiddleware)
packages/mcp-server/src/tools/sayknowmind.ts (forward rawToken)
packages/mcp-server/src/tools/query.ts       (gate)
packages/mcp-server/src/tools/document.ts    (gate non-admin)
packages/mcp-server/src/tools/graph.ts       (gate non-admin)
```

## Appendix B — files touched in Phase 2

```
apps/web/lib/visibility.ts                   (new — single source of truth for the WHERE clause)
apps/web/app/api/search/route.ts             (swap WHERE)
apps/web/app/api/documents/route.ts          (swap WHERE)
apps/web/app/api/documents/[id]/route.ts     (GET only; PATCH/DELETE stay private)
apps/web/app/api/documents/[id]/related/route.ts (visible related docs)
apps/web/app/api/categories/route.ts         (visible category reads)
apps/web/lib/categories/store.ts             (visible category list/get; owner-only writes)
apps/web/app/api/categories/[id]/documents/route.ts (visible docs under visible category)
apps/web/app/api/knowledge/graph/route.ts    (visible graph projections)
apps/web/app/api/knowledge/node/[nodeId]/route.ts (visible node/doc reads)
apps/web/lib/agents/pipeline.ts              (searchKnowledge WHERE)
apps/web/app/api/share/gallery/route.ts      (audit)
apps/web/app/api/integrations/telegram/webhook/route.ts (search-from-chat path)
apps/web/lib/edgequake/client.ts             (audit/enforce user_id metadata)
apps/web/__tests__/multitenant-isolation.test.ts (new)
```
