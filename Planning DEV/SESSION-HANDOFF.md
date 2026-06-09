# Session Handoff — 2026-06-06

Branch: `feat/collab-docs-mindmaps-rag`
Status: **all changes below are UNCOMMITTED** (working tree dirty). Nothing pushed.

This session focused on getting the full stack running locally, then building out the
collaborative document editor (tabs, embedded mind-maps, embedded HTML) and fixing a
string of UX / infra / data-loss bugs surfaced while testing.

---

## 1. What changed (uncommitted)

### New files
- `apps/web/components/docs/doc-tabs.tsx` — the entire multi-tab document editor. Owns
  tab state, persistence, and real-time collab. Replaces the old single-editor render
  path. Contains `DocTabs` (dispatcher), `DocTabsSingle`, `DocTabsCollab`, `DocTabsLayout`
  (UI), `TabEditor`/`SingleTabEditor`/`CollabTabEditor`.
- `apps/web/components/docs/doc-schema.ts` — shared BlockNote schema (`docSchema`) extending
  defaults with the custom `mindmap` + `html` blocks; exports `DocBlock` type.
- `apps/web/components/docs/mindmap-block.tsx` — custom BlockNote block embedding an
  editable mind-elixir mindmap; data stored in block prop (`data` = JSON).
- `apps/web/components/docs/html-block.tsx` — custom BlockNote block rendering raw HTML in a
  sandboxed iframe (slash-menu `/HTML`, inline block form).

### Modified
- `apps/web/components/docs/doc-editor-dynamic.tsx` — now renders `DocTabs` (ssr:false);
  prop changed from `initialBlocks` → `initialMetadata`; added `onBack`.
- `apps/web/components/docs/inline-editor.tsx` — passes `initialMetadata`, `onBack`; hides
  its own back-bar for docs (DocTabs renders its own header).
- `apps/web/app/docs/[id]/page.tsx` — `<main>` changed `min-h-screen` → `h-screen
  overflow-hidden` so the editor / full-page HTML iframe get a definite height (was
  collapsing to 0 → "HTML not showing" bug).
- `apps/web/components/docs/doc-editor.tsx`, `doc-editor-collab.tsx` — theme follows app
  (next-themes `resolvedTheme`), BlockNote `dictionary` set per app locale. NOTE: these two
  are now OFF the render path (DocTabs supersedes them) but left in tree; candidate for
  dead-code removal.
- `apps/web/components/auth/auth-modal.tsx` — single "keep me signed in" checkbox now also
  remembers the EMAIL (localStorage); password is NOT stored (browser/OS password manager
  handles it). Purges a legacy plaintext-credentials key.
- `apps/web/lib/auth.ts` — session lifetime 1d → 30d (`expiresIn`), updateAge → 1d.
- `apps/web/lib/categories/store.ts` — **bugfix**: `updateCategory` descendant path-update
  query had `depth + ($3 - $4)` with untyped params → Postgres `operator is not unique:
  unknown - unknown` → 500 on collection rename. Fixed with `::int` casts (and
  `substring(path from $2::int)`). Both admin + non-admin queries.
- `apps/web/next.config.ts` — CSP `connect-src` now allows `ws://localhost:*
  wss://localhost:*` + the `NEXT_PUBLIC_COLLAB_WS_URL` origin (WebSocket uses the ws: scheme,
  not covered by the http: localhost sources). Added `collabWsOrigin` helper.
- `apps/web/messages/{en,ko,zh,ja}.json` — i18n keys added: `auth.rememberEmail` (later
  consolidated), `tabs.{defaultName,newTabName,rename,delete,title}`,
  `mindmap.{blockTitle,blockSubtext,blockGroup,blockDefaultTopic}`,
  `html.{blockTitle,blockSubtext,placeholder,render,edit,empty,insertFile,removePage}`.
- `scripts/start-all.sh` — edgequake now uses `EDGEQUAKE_DATABASE_URL` (its own DB), not the
  web app's `sayknowmind` DB. See section 4.
- `.env` (NOT in git; gotcha) — added `EDGEQUAKE_DATABASE_URL=...localhost:5433/edgequake`.

---

## 2. Features delivered

- **Document tabs** — left vertical tab menu (add `+`, click=switch, dbl-click=rename,
  hover `×`=delete). Per-tab independent content. Persisted under
  `metadata.docTabs = { tabs:[{id,name,html?}], blocks:{[id]:Block[]} }` (one top-level key;
  the documents API merges metadata with JSONB `||` so the whole `docTabs` object is written
  each save). Collab: tab list synced via `ydoc.getArray("docTabs")`, each tab's content via
  `ydoc.getXmlFragment("tab:"+id)`. Backward-compat: legacy `metadata.blocknote` migrates to
  one tab.
- **Inline mind-map block** — slash `/마인드맵`. mind-elixir in a custom block, data in prop,
  syncs via BlockNote/Yjs. Feedback-loop guard (JSON compare + updatingRef).
- **HTML embed** — two forms: (a) slash `/HTML` inline block; (b) toolbar **"HTML 파일 삽입"**
  button → picks a `.html` file → fills the WHOLE content area as a full-page sandboxed
  iframe (stored as `tab.html`; `✕ HTML 페이지 제거` returns to the editor). Sandbox:
  `allow-scripts allow-popups allow-forms allow-modals` (no allow-same-origin).
- **Editor dark/light** + **BlockNote UI localized** (slash menu, placeholders, toolbar) via
  `@blocknote/core/locales`.
- **UX polish** — unified top toolbar (back · live · save-status pill · summary · insert-HTML),
  title as clean H1, refined left tab menu (active accent bar). Dual-sidebar (app nav + tab
  menu) kept per user choice; "focus mode" (collapse app nav) offered, not built.

---

## 3. Bugs fixed this session

- **Collection rename 500** — `::int` cast (see store.ts above). Verified at DB level.
- **Full-page HTML not showing** — `/docs/[id]` page height (`h-screen`).
- **fsevents / sharp Gatekeeper popups** — external-volume native `.node` files quarantined;
  cleared repo-wide (`find . -name "*.node" -exec xattr -d com.apple.quarantine {} \;`).
- **edgequake migration panic** — was pointed at the wrong DB (see section 4).
- **CSP blocking collab WS** — `ws://` added to connect-src.
- **TAB DATA LOSS (important)** — creating a tab, leaving, returning, then adding a tab wiped
  all tabs to one. Two causes, both fixed in `doc-tabs.tsx`:
  1. Collab `yTabs` could be empty on return (relay clears in-memory room; offline-fallback
     skipped seeding), so an incremental push made the observer overwrite React state with
     just the new tab. Fixed: `writeTabs()` now FULL-REPLACES the shared list from the
     authoritative local `tabs` on every structural change (add/delete/rename/setHtml).
  2. Autosave was debounced 800ms → leaving fast lost the change. Fixed: structural tab
     changes use `saveNow()` (immediate persist); content edits still debounce.

---

## 4. Local run state / environment (IMPORTANT)

All 7 services were brought up this session. See memory `how-to-run-locally` for the full
procedure. Key points:

- `bash scripts/start-all.sh` starts edgequake(5403), mcp(8082), ai-server(4000), ipfs(5001
  — Kubo not installed locally, shared mode off), web(5400). Relay is NOT in start-all.
- **relay-server (collab WS, :5402) must be started manually**:
  `cd packages/relay-server && set -a; source ../../.env; set +a; PORT=5402 node dist/index.js`
  (reads `PORT`, default 3200 — must pass 5402). It was running this session (pid changes).
- **edgequake uses its OWN database** `edgequake` (already fully migrated), NOT `sayknowmind`.
  They collide on `public.entities` (web's has `type`, edgequake needs `entity_type`).
  `.env` now has `EDGEQUAKE_DATABASE_URL`; start-all passes it. Web talks to edgequake only
  via HTTP (`lib/edgequake/client.ts` → :5403), never the DB.
- Postgres at :5433 is an SSH tunnel; has both `sayknowmind` and `edgequake` DBs.
- The web dev server was restarted manually this session to pick up the `next.config.ts` CSP
  change (config is not HMR'd).

### Local login (dev accounts, password reset this session)
- `sayknowai@gmail.com` — password `SayKnow!2026` (the user's account; 0 documents)
- `kira.test@local.dev` — password `SayKnow!2026` (has 20 documents — use this to see data)
- Passwords were re-hashed with better-auth scrypt directly in the `account` table.

---

## 5. Known issues / pending

- **Collab "Won't try again" + 5-min token TTL** — collab is VERIFIED working end-to-end
  (tested with real account+doc → relay AUTHENTICATED). The earlier console error was a stale
  tab: Hocuspocus provider gives up permanently (`shouldConnect=false`) on an unauthorized
  close, so the CSP-blocked first attempt stuck it until reload. LATENT BUG: collab tokens
  expire in 5 min (`issueCollabToken` exp); a WS reconnect after that uses the stale token →
  permanent disconnect. Recommended next step: refetch a fresh token on reconnect/auth-fail.
  (Offered to the user; not yet built.)
- **HTML page tabs not in RAG** — a full-page HTML tab has no rich blocks, so its text isn't
  in the `content` plaintext projection (not searchable). Acceptable for display; note if RAG
  over embedded HTML is wanted.
- **Tab reorder (drag)** — not implemented (add/switch/rename/delete only).
- **doc-editor.tsx / doc-editor-collab.tsx** — superseded by doc-tabs; dead-code removal
  pending (kept to avoid churn).
- **Concurrent same-tab-list edits in collab** — `writeTabs` full-replace is last-write-wins
  on the tab list (per-tab CONTENT is still proper CRDT). Fine for low-contention; note it.
- AI provider keys unset in `.env` → edgequake LLM provider is `mock`; ai-server LLM falls
  back. RAG/embeddings are mock-quality until keys/Ollama wired.

---

## 6. Verification done

- `npx tsc --noEmit` clean for all touched files throughout.
- Web compiles (HTTP 200, `✓ Compiled`) after each change.
- Collection-rename `::int` fix verified against Postgres directly.
- Collab chain verified end-to-end with a real token + real doc id (AUTHENTICATED).
- NOT verified by clicking through the browser UI (no interactive UAT this session) — the
  tab/mindmap/HTML features compile and the logic was reviewed, but a manual pass in the
  browser (create tabs, insert mindmap, insert HTML file, dark mode, rename collection,
  reload to confirm persistence) is the recommended first action next session.

---

## 7. Suggested next steps

1. Manual UAT pass in the browser (login as `kira.test@local.dev` / `SayKnow!2026`,
   hard-reload first).
2. Commit this work — it's a large but coherent set. Suggested grouping if splitting:
   infra (edgequake DB, CSP, start-all) · auth (session, remember-email) · editor (tabs,
   mindmap block, html block, theme, i18n) · fixes (category rename, doc page height,
   tab data-loss).
3. Harden collab token refresh (5-min TTL issue) if real-time collab is in scope.
4. Optionally remove dead `doc-editor*.tsx`.

---

## 8. 2026-06-08 update — current issue fixes

Fixed in this continuation:

- **Collab token TTL / stale reconnect hardening** in `apps/web/components/docs/doc-tabs.tsx`
  - Collab session fetch is now centralized and validated.
  - HocuspocusProvider now receives an async token function instead of a static token.
  - Tokens are refreshed when expired/near expiry (60s skew) before a WS connection authenticates.
  - `authenticationFailed` and WS close `4401 Unauthorized` now force a fresh token and explicitly restart provider connection with capped exponential backoff, avoiding the previous "Won't try again" dead state.
  - `synced:false` no longer marks the UI connected.
- **Office document visibility in Documents folder** in `apps/web/store/memory-store.ts`
  - The Documents namespace filter now treats `doc`, `word`, `sheet`, and `slide` as one document-like group, so newly created Office files don't disappear when a Documents folder is selected.
- **Lint warning cleanup in new docs/office files**
  - Removed obsolete `@typescript-eslint/no-explicit-any` disable comments from new untracked docs/office files.

Verification after these changes:

- `cd apps/web && pnpm exec tsc --noEmit` — PASS
- `cd apps/web && pnpm lint` — PASS with 16 pre-existing warnings, 0 errors
- `cd apps/web && pnpm build` — PASS
- `curl -I http://localhost:5400/` — HTTP 200 and CSP includes `ws://localhost:5402`

Browser UAT note:

- Attempted in-app Browser smoke, but this Codex session reported `Browser is not available: iab`.
  Manual/interactive UAT is still pending: create doc/word/sheet/slide tabs, reload persistence, collab reconnect after token expiry, HTML and mindmap insert/edit.
