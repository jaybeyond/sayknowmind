# Code Review — feat/collab-docs-mindmaps-rag

**Date:** 2026-07-02
**Scope:** `git diff main...HEAD` + uncommitted working tree (~86 files, ~6,200 lines)
**Method:** 10 finder angles → per-candidate adversarial verification (Opus 4.8, 3-state CONFIRMED/PLAUSIBLE/REFUTED) → gap sweep
**Result:** 15 confirmed defects reported; 5 refuted (false positives / intentional); ~5 low/latent; ~12 cleanup items.

Legend — Verdict: **C** = CONFIRMED (inputs + wrong output named), **P** = PLAUSIBLE (mechanism real, trigger conditional).

---

## Fix log

**2026-07-02 — all 6 P0 criticals fixed** (typecheck clean, 22 security/validation tests pass):

- **C1** — added `getUserIdFromRequest()` auth to `/api/models/{active,route,[name],embedding/test}` handlers (the edge middleware intentionally defers bearer validation for the cookieless Flutter app; the hole was handlers not re-authenticating).
- **C2** — replaced the pooled-client `pg_advisory_lock` (held across `signInEmail`) with an in-process per-user async mutex that holds no DB connection; hash moved outside the critical section; `db.ts` pool given finite `connectionTimeoutMillis` + explicit `max` as a backstop.
- **C3** — `originTrusted()` now matches custom schemes by exact string only (opaque `null` origins no longer compared), and allows Origin-less non-browser clients (CSRF-safe: browsers always send Origin).
- **C4** — chat paths (`cloud-ai.ts`, `cloud-chat.ts`) now use `safeFetch`; provider-save validates non-relay `baseUrl` via `validateUrl`.
- **C5** — `deleteDocument` retries on 409 (pending/processing); new `deindexDocumentIfUnreferenced()` reference-counts before deleting (dedup-safe) and is used by all 4 delete sites; `syncUnindexedToEdgeQuake` stamps each doc's true owner instead of the caller.
- **C6** — `reconstructNodeData` derives the root from the atomically-written structure blob (not nondeterministic node-map iteration), so an orphan can't be picked as root and the `writeToYDoc` delete-loop can't prune the shared map.

**2026-07-02 — P1 + P2 + P18 fixed; P19 accepted; one cleanup done** (all packages typecheck; web 45 tests + token round-trip pass):

- **C7** — desktop `assert_trusted_webview` converted to a fail-closed allowlist (trust only `tauri://` / localhost / 127.0.0.1 / ::1 / tauri.localhost); guard removed from `chat_via_codex`/`complete_via_codex` (LLM-relay data path, must be callable from the lite webview) while exec/install/key commands stay guarded. `cargo check` clean.
- **C8 + C9 + P18** — shared `reindexDocumentById()` added; the PATCH route and relay `applyUpdate` now invalidate + de-index + re-index on content change (edited docs stay in RAG); PATCH only writes `eq_document_id = NULL` when the column is confirmed present (no 42703 500).
- **C10** — mindmap `synced` handler migrates the legacy `getMap("mindmap").data` blob into the per-node maps before seeding.
- **C11** — Helm `sayknowmind.image` selects `-web-local` when `app.authMode=local`; CI builds both `-web` (saas) and `-web-local` (local) so the baked client edition can't diverge from the runtime auth mode. Verified with `helm template`.
- **C12** — Go SDK `Chat` now takes `*ChatOptions` (old `Chat(msg, "simple")` no longer compiles → loud break, not silent).
- **C13** — `SignatureGuard` registered as a global `APP_GUARD` (deny-by-default) with a `@Public()` decorator on the health controller; per-controller guards kept as defense-in-depth.
- **C14** — TS/Python/Go SDK `chat()` now surface the server `{type:"error"}` event as a thrown error instead of a blank success.
- **C15** — `/api/og/[id]` authorizes viewers via the dashboard's `readableClause` (org/team/resource-share), not just owner.
- **C16** — `savedPositions` removed from the graph-canvas `useMemo` deps (no full re-layout per drag); persistence moved out of the state updater via a ref.
- **C17** — `url-fetcher` rethrow now checks membership in the app `ErrorCode` set, so a DOMException timeout (`.code` 23) is wrapped as `INGEST_FETCH_FAILED` instead of leaking.
- **P19** — LEFT AS-IS: the `tenant_id IS NULL` removal is a deliberate fail-closed isolation tightening (reverting re-opens a cross-tenant leak); not exercised on the single-tenant live path; already documented in-code.
- **Cleanup** — extracted the duplicated multi-secret HMAC verification into `packages/relay-server/src/auth/hmac.ts`, used by both relay-token and collab-token (round-trip / tamper / rotation / unknown-secret all verified).

**2026-07-02 — remaining cleanup pass** (web typecheck + edgequake `cargo check` clean):

- **Bounded-concurrency de-index** — added `deindexDocuments(ids, label, concurrency=5)` to the EdgeQuake client; the admin user-delete and empty-trash paths now drain de-indexing through it instead of firing one un-awaited DELETE per document (socket-pool burst on heavy accounts).
- **PPR lane parallelism** — `query_ppr` / `query_ppr_with_vector_storage` now run the dense + graph lanes with `tokio::try_join!` (latency = max, not sum).
- **DEFERRED (deliberate / high-risk / cosmetic):** share-menu & collab-token-refresh UI extraction (auth-critical, runtime-only verification — a blind refactor risks silent collab-reconnect breakage); `ocp_install` shallow clone (the full clone is a *documented* deliberate choice for arbitrary-SHA checkout robustness, and the feature is SHA-gated); `withOrgRls` / `all_including_experimental` dead code (harmless forward-plumbing); PATCH extra-SELECT micro-opt; deploy-list divergence (031 self-guards in SQL → benign drift). These are tracked in the table below.

---

## P0 — Critical (fixed 2026-07-02)

Security holes exploitable without valid auth, availability-killers, or data loss.

### C1. Bearer-token auth is a no-op on `/api/models/*` → unauthenticated model config mutation/deletion
- **File:** `apps/web/middleware.ts:72` (+ `apps/web/app/api/models/active/route.ts`, `apps/web/app/api/models/[name]/route.ts`)
- **Verdict:** C · **Type:** Security (authz)
- **Mechanism:** `hasBearerToken()` was widened from requiring the `sk-mcp-` prefix to accepting any `Bearer <x>`. Middleware treats a Bearer request as authenticated and forwards it; the `/api/models` handlers do no in-handler auth (only `provider/route.ts` calls `getUserIdFromRequest`).
- **Failure:** `curl -X POST -H 'Authorization: Bearer x' /api/models/active -d '{"model":"evil","role":"chat"}'` rewrites the global active model; `DELETE /api/models/<name>` deletes an Ollama model — both with no session.
- **Fix direction:** Enforce auth in a shared handler layer (or a real token-validating middleware), not a presence-check that assumes handlers re-authenticate.

### C2. `pg_advisory_lock` held across `signInEmail` → whole-pool deadlock
- **File:** `apps/web/app/api/auth/external-login/route.ts:157` (pool config `apps/web/lib/db.ts`)
- **Verdict:** C · **Type:** Availability / DoS
- **Mechanism:** A session-level advisory lock is held on a checked-out pool client while awaiting `signInEmail`/`updatePassword`, which draw additional connections from the same pool (`max=10`, `connectionTimeoutMillis=0` → wait forever).
- **Failure:** ~10 concurrent same-user logins each hold a client blocked on the lock; the winner then waits forever for an 11th connection → all logins and every other DB-backed route hang until process restart.
- **Fix direction:** Compute the password hash before `pool.connect()`; set `lock_timeout`/`connectionTimeoutMillis`; shrink the lock window to just `updatePassword` + `signInEmail`, ideally without pinning a pooled client across the whole flow.

### C3. `originTrusted()` CSRF allow-list bypassable (opaque `null` origin) + legit clients falsely 403'd
- **File:** `apps/web/app/api/auth/external-login/route.ts:55`
- **Verdict:** C (both facets) · **Type:** Security (CSRF) + breakage
- **Mechanism:** `new URL(candidate).origin === new URL(trusted).origin` — every custom-scheme URL has opaque origin `'null'`, and the trusted list contains `tauri://localhost` / `sayknowmind://` (also `'null'`). Any custom-scheme Origin matches. Conversely, clients sending no Origin/Referer are rejected.
- **Failure:** `Origin: evil://attacker` is treated as trusted (defeats the guard); `curl`/Flutter enterprise login with valid creds but no Origin header → 403 before credentials are read.
- **Fix direction:** Match custom schemes by exact string only (already covered); drop the `.origin` fallback for opaque origins; allow credential-only clients that legitimately omit Origin.

### C4. SSRF hardening applied only to the listing proxy; chat + provider-save unguarded
- **File:** `apps/web/lib/agents/cloud-ai.ts:117`, `apps/web/lib/agents/cloud-chat.ts:71`, `apps/web/app/api/settings/providers/route.ts`
- **Verdict:** C · **Type:** Security (SSRF)
- **Mechanism:** `validateUrl`+`safeFetch` guard only `/api/models/provider`. The actual chat-completion path and the provider-save route use the user-supplied `baseUrl` with raw `fetch()` and no validation.
- **Failure:** A saved `baseUrl` of `http://169.254.169.254/...` or an RFC-1918 host is persisted unvalidated and reached by `fetch(\`${baseUrl}/v1/chat/completions\`)` → server-side request forgery on the primary data path.
- **Fix direction:** Make the outbound provider fetch a single guarded helper (validate + safeFetch) used by listing, chat, streaming, and save.

### C5. EdgeQuake document lifecycle — three data-integrity defects
- **File:** `apps/web/lib/edgequake/client.ts:249` (delete), `:341` (sync attribution); `apps/web/lib/ingest/job-queue.ts:446` (1:1 assumption)
- **Verdict:** C (all three) · **Type:** Data integrity / loss
- **Mechanisms & failures:**
  - **(a) 409 → orphaned vectors.** `deleteDocument` swallows only HTTP 404; EdgeQuake returns 409 for `pending`/`processing` docs (normal right after async sync). Callers fire-and-forget after the Postgres row (holding the only `eq_document_id`) is hard-deleted → vectors orphaned forever.
  - **(b) content-hash dedup → cross-doc index deletion.** Storing `eqRes.document_id` assumes 1:1, but EdgeQuake dedups by content hash per workspace, so one EQ doc backs multiple PG rows. Users A & B ingest identical content → B's delete removes A's index.
  - **(c) wrong-owner attribution.** `syncUnindexedToEdgeQuake` stamps the *caller's* userId (`X-User-ID` + `metadata.user_id`) on every org doc it re-indexes. Teammate Y reprocesses X's edited doc → X's content re-indexed under Y.
- **Fix direction:** Tolerate 409 (retry/defer) in `deleteDocument`; key EQ doc identity so dedup can't alias rows; carry the true owner's userId through the reprocess path.

### C6. Mindmap orphan-root selection → shared-doc data loss
- **File:** `apps/web/components/docs/mindmap-editor.tsx:96` (`reconstructNodeData`) + `:415` (`writeToYDoc` delete loop)
- **Verdict:** C · **Type:** Data loss (concurrency)
- **Mechanism:** Root = first `mindmap:nodes` key not referenced as a child, with no tie-break. Concurrent add/delete merges can leave an orphan; Y.Map iteration order can surface it first, so the map reconstructs as just that subtree. The next local edit's `writeToYDoc` delete-loop then prunes every `ynodes` entry not in the truncated tree — propagated to all peers.
- **Failure:** Peer A deletes node N while peer B adds child C under N; on a peer whose iteration yields C first, the mindmap renders as one node and the next keystroke deletes the rest for everyone.
- **Fix direction:** Validate/deterministically pick the root (persist a root id in meta); never let a reconstruction ambiguity drive a destructive prune.

---

## P1 — High (fix this cycle)

Serious functional breakage, silent data staleness, broad regressions.

### C7. Desktop `assert_trusted_webview` breaks codex relay (lite) + fail-open denylist
- **File:** `apps/desktop/src-tauri/src/main.rs:653` (`complete_via_codex`/`chat_via_codex`), `:64` (the guard)
- **Verdict:** C (both facets) · **Type:** Breakage + security
- **Mechanism:** The guard is applied to the codex completion commands, which the lite build's relay worker (`apps/web/lib/llm-relay/worker.ts`) invokes *from the remote webview* → every codex relay job fails; the parallel `complete_via_ocp`/`chat_via_ocp` stay unguarded. Separately, the guard is a denylist (`host_str()==None`→`""`, OAuth hosts → "trusted"), so it fails open for other privileged commands.
- **Failure:** desktop-lite (webview on REMOTE_HOST) with codex configured → `Err('privileged command rejected')` on every codex job while OCP jobs work.
- **Fix direction:** Remove the guard from the codex completion commands (they must be callable by the relay webview, like the OCP pair); convert `assert_trusted_webview` to an allowlist (trust only localhost/127.0.0.1, reject empty/unknown) and keep it on exec/install/key-provision commands only.

### C8. Edited documents silently drop out of RAG (no auto-reindex)
- **File:** `apps/web/app/api/documents/[id]/route.ts:142`
- **Verdict:** C · **Type:** Functional regression
- **Mechanism:** Content PATCH nulls `indexed_at`/`eq_document_id` and de-indexes from EdgeQuake, but no cron/interval calls `syncUnindexedToEdgeQuake`/`runReprocessor`. The dashboard "reprocess" button only targets `summary IS NULL` docs.
- **Failure:** User edits a note/sheet/mindmap → doc marked unindexed + removed from EdgeQuake → absent from search/chat until someone manually hits `reprocess?auto=1` or `sync-edgequake` (no UI caller). Pre-diff it stayed searchable (merely stale).
- **Fix direction:** Trigger re-index automatically after invalidation (background job/queue), or don't de-index until the replacement is ready.

### C9. Relay-synced content edits leave a permanently stale index
- **File:** `apps/web/lib/relay/sync-service.ts:329` (`applyUpdate`)
- **Verdict:** C · **Type:** Functional
- **Mechanism:** The relay pull path updates `content` via a raw UPDATE that never nulls `indexed_at`/`eq_document_id` nor de-indexes — unlike the PATCH route and `updateDocument`. The reprocessor selects `WHERE indexed_at IS NULL`, so the row is never re-selected.
- **Failure:** Edit content on device A; it syncs to B via relay → EdgeQuake serves the old content forever, old vector never removed.
- **Fix direction:** Move index-invalidation into one shared document-mutation function every write path calls (PATCH, `updateDocument`, relay `applyUpdate`).

### C10. Mindmap Y.Doc format change has no legacy migration + mixed-version divergence
- **File:** `apps/web/components/docs/mindmap-editor.tsx:462` (seed/apply path)
- **Verdict:** C (no-migration) / P (mixed-version) · **Type:** Data loss (bounded)
- **Mechanism:** Collab moved from a single `getMap('mindmap').get('data')` blob to per-node `mindmap:nodes`/`mindmap:meta`, with no read path for the old key. Old docs `applyRemote`-early-return and reseed from at-rest data; during a rolling deploy, old- and new-bundle peers write disjoint maps.
- **Failure:** Existing collaborated mindmap reopens post-deploy → persisted CRDT discarded, unflushed collab edits lost. During rollout, peers show "connected" but never see each other's edits and clobber the row via autosave.
- **Fix direction:** One-time migration reading the legacy `data` key into the new maps; version the room or gate on format.

### C11. `NEXT_PUBLIC_AUTH_MODE` build-time bake vs runtime configmap → staging login split-brain
- **File:** `deploy/helm/sayknowmind/templates/configmap-app.yaml:15` (+ `.github/workflows/ci.yml:170`, `values-staging.yaml:34`)
- **Verdict:** C · **Type:** Deployment
- **Mechanism:** `NEXT_PUBLIC_*` is inlined into the client bundle at build time. CI builds the single web image with `NEXT_PUBLIC_AUTH_MODE=saas`; the configmap injects the value at pod runtime from `.Values.app.authMode`.
- **Failure:** Staging (`authMode: local`) runs the `saas`-built image → client JS has `isSaasAuth=true` (renders SayKnowWork login) while server routes read runtime `local` (built-in email/password) → login UI and auth path disagree, login broken.
- **Fix direction:** Build a per-edition image (or a runtime-config shim that isn't `NEXT_PUBLIC_*`); ensure the build arg matches the values the image is deployed with.

### C12. Go SDK `Chat` param meaning changed silently + `Search` compile break
- **File:** `packages/sdk-go/sayknowmind.go:242` (`Chat`), `:~230` (`Search`)
- **Verdict:** C · **Type:** API break
- **Mechanism:** `Chat`'s 2nd string param changed from `mode` to `conversationID` (same arity/type — compiles unchanged). `Search` gained a required `*SearchFilters` param.
- **Failure:** `client.Chat("hi","simple")` now POSTs `conversationId:"simple"` → server runs `SELECT ... WHERE id='simple'` against a uuid column → 500 (or 404). `Search(q,mode,limit)` callers fail to compile.
- **Fix direction:** Restore back-compat or bump a major version with a migration note; consider a typed options struct.

### C13. ai-server auth is fail-open (per-controller guard, no global `APP_GUARD`)
- **File:** `apps/ai-server/src/intelligence/gdpr.controller.ts:26` (+ analytics/feedback/ai controllers; `app.module.ts`)
- **Verdict:** C · **Type:** Security (structural)
- **Mechanism:** `SignatureGuard` is applied per-controller via `@UseGuards`, with no global `APP_GUARD` and no `@Public()` opt-out. Default for any new/forgotten controller is unauthenticated.
- **Failure:** A controller added later without the decorator ships unauthenticated, re-opening the unauth-destructive-endpoint class (e.g. GDPR delete) this change was meant to close.
- **Fix direction:** Register `SignatureGuard` once as `APP_GUARD`; mark the health endpoint `@Public()`.

---

## P2 — Medium (fix soon)

Correctness bugs and user-visible regressions with narrower blast radius.

### C14. SDK `chat()` swallows server `{type:"error"}` events → blank success
- **File:** `packages/sdk-sayknowmind/src/client.ts:155` (+ `sdk-python/.../client.py:224`, `sdk-go/sayknowmind.go:303`)
- **Verdict:** C · **Type:** Correctness
- **Mechanism:** The aggregating `chat()` handles only `answer`/`sources`/`done`; `stream-writer.ts:46` emits `{type:"error",message}` on pipeline failure, then closes with no `done`.
- **Failure:** All LLM providers error mid-stream → `chat()` falls through every branch and resolves to `{answer:""}` raising nothing → caller sees a silent empty success.
- **Fix direction:** Add an `error` case that throws/rejects with the server message.

### C15. `/api/og` proxy serves placeholder to non-owner shared viewers
- **File:** `apps/web/store/memory-store.ts:106` (+ `apps/web/app/api/og/[id]/route.ts`)
- **Verdict:** C · **Type:** Regression (UX)
- **Mechanism:** `documentToMemory` rewrites every external ogImage to `/api/og/{id}`, but that route authorizes only `privacy_level='shared'` or the owner. Docs shared via `resource_shares`/`resource_team_shares` stay `private` (now the default).
- **Failure:** Teammate B viewing a doc A shared to them → `/api/og/{id}` sees `private` + non-owner → placeholder, despite legitimate read access.
- **Fix direction:** Have the og route apply the same `readableClause` visibility used by `/api/documents`.

### C16. Knowledge graph re-lays-out on every node drag
- **File:** `apps/web/components/knowledge/graph-canvas.tsx:252`
- **Verdict:** C · **Type:** UX / performance
- **Mechanism:** `savedPositions` moved from a ref into React state and added to the graph-data `useMemo` deps. Each drag-end (`setSavedPositions`) rebuilds all `FGNode` objects with new identities, discarding live d3-force x/y of unpinned nodes → simulation re-seeds and reheats.
- **Failure:** Dropping one node scatters/re-layouts the whole graph. (Minor secondary: `persistSavedPositions` called inside the state updater → double localStorage write under StrictMode.)
- **Fix direction:** Restore the ref-based persistence in `onDragEnd`; keep `savedPositions` out of the memo deps.

### C17. `url-fetcher` rethrows fetch-timeout `DOMException` as an invalid API error code
- **File:** `apps/web/lib/ingest/url-fetcher.ts:207` (+ `apps/web/app/api/ingest/url/route.ts:56`)
- **Verdict:** C · **Type:** Correctness / API contract
- **Mechanism:** The guard `if ((err as {code?:number}).code !== undefined) throw err` (meant to preserve tagged SSRF errors) also matches `DOMException` (`TimeoutError.code === 23`), so timeouts skip the `INGEST_FETCH_FAILED` (2002) wrap.
- **Failure:** Ingesting a slow URL → API returns `{code: 23}` (not a valid `ErrorCode`) → client error-code mapping/i18n breaks.
- **Fix direction:** Guard on membership in the app `ErrorCode` set (or an explicit tag), not the presence of a numeric `.code`.

---

## P3 — Low / latent (track)

### P18. PATCH `eq_document_id = NULL` throws 42703 if the self-heal ALTER failed
- **File:** `apps/web/app/api/documents/[id]/route.ts:143` · **Verdict:** P
- `ensureEqDocumentIdColumn()` is in a tolerant try/catch, but the later UPDATE unconditionally references the column. Only fires if the column is genuinely absent *and* the ALTER persistently fails (restricted DDL/lock timeout) — belt-and-suspenders since migration 064 adds it. Fix: gate the clause on ensure-success, or fail fast like `updateDocument`.

### P19. EdgeQuake relationship filter drops legacy NULL-tenant edges
- **File:** `packages/edgequake/crates/edgequake-storage/src/adapters/postgres/graph/mod.rs:1407` · **Verdict:** P (low)
- The tenant filter changed `(r.tenant_id IS NULL OR r.tenant_id = X)` → fail-closed `r.tenant_id = X`. Intended isolation tightening; only degrades if NULL-tenant edges exist (single→multi-tenant transition, no backfill). Not exercised on the current single-tenant live path.

### I20. `ocp_install` ships with placeholder `OCP_PINNED_REF` (deliberate gate)
- **File:** `apps/desktop/src-tauri/src/main.rs:38/1074` · **Verdict:** C, but *by design*
- The Install button errors on every shipped build until a maintainer pins an audited SHA. This is a documented fail-closed supply-chain gate (DESK-2), not a logic bug — but the feature is non-functional as committed. Action: pin the SHA before any release that expects OCP install to work.

---

## Refuted (verified false positives / intentional)

- **org-context defaults to `private`** — intentional privacy-by-default (DB-10), backed by migration 065 and per-resource ACL. Not a regression.
- **deploy 031 `DROP TABLE` re-run** (both the deploy.yml/production-deploy.sh divergence and the transient-probe facet) — the `031_conversations_simple.sql` DROP is self-guarded by an in-SQL `DO $$ … IF EXISTS(conversation_id/tenant_id)` block, so re-running is a no-op on a live simple-schema DB. No data loss.
- **models/provider 502 leaks internal detail** — SSRF/redirect errors carry `code === INGEST_INVALID_URL` and are diverted to a generic 400; only benign "fetch failed"/"too many redirects" reach the 502.
- **Go SDK 64KB `bufio.Scanner` cap** — the server bounds the `sources` event to 5 sources with ~500-char excerpts, well under 64KB.

---

## Cleanup / non-bug (worth addressing)

Quality items surfaced by the reuse/simplification/efficiency angles — not correctness bugs, ranked below all of the above.

| Item | File(s) | Note |
|---|---|---|
| Multi-secret HMAC verify duplicated | `packages/relay-server/src/auth/{collab,relay}-token.ts` | Extract one `verifySignature()` + `VERIFY_SECRETS` helper |
| De-index boilerplate copied ×5 | `documents/{trash,[id]}`, `admin/users/[id]`, `relay/sync-service.ts` | Extract `deindexEdgeQuakeRows()` next to `deleteDocument` |
| Collab token-refresh machinery duplicated | `docs/{doc-tabs,mindmap-editor}.tsx` | Extract a `useCollabProvider` hook |
| Share dropdown duplicated | `docs/{doc-tabs,mindmap-editor}.tsx` | Extract `<DocShareMenu docId title />` |
| Migration list duplicated (guard only in one) | `.github/workflows/deploy.yml` vs `scripts/production-deploy.sh` | Single shared runner (the 031 DROP is safe, but the lists will drift) |
| PPR lanes awaited sequentially | `edgequake-query/src/sota_engine/query_ppr.rs:60` | `tokio::try_join!` the dense + graph lanes |
| Extra SELECT in PATCH hot path | `documents/[id]/route.ts:120` | Capture old `eq_document_id` in the UPDATE's RETURNING |
| `withOrgRls()` dead / RLS inert | `apps/web/lib/db.ts:39` | No callers; app connects as superuser so migration-066 RLS is inert — delete or wire up |
| `all_including_experimental()` dead | `edgequake-query/src/modes.rs:97` | Only its own test calls it |
| Full clone instead of shallow | `apps/desktop/src-tauri/src/main.rs:1135` | `git fetch --depth=1 <ref>` |
| Unbounded concurrent EQ deletes | `admin/users/[id]/route.ts:85`, `documents/trash/route.ts` | Concurrency-limit or bulk delete endpoint |
| `writeToYDoc` rewrites all nodes each push | `docs/mindmap-editor.tsx:415` | Skip `ynodes.set` when value unchanged |

---

## Priority order

1. **C1–C6 (P0)** — the four security holes (C1–C4) and the two data-loss defects (C5, C6). C2 also takes down all logins under concurrency.
2. **C7–C13 (P1)** — relay-worker breakage, the two RAG-staleness bugs (C8/C9 share a root cause — centralize index invalidation), mindmap migration, the deploy split-brain, the SDK break, and the ai-server guard.
3. **C14–C17 (P2)**, then **P18–I20** and cleanup.
