# Collaborative Docs & Mind Maps — Plan

Goal: let users **author content directly** in SayKnowMind (Notion / GitHub-Docs style),
**collaborate** in real time, optionally build **mind maps** (XMind style), and save it all
into the existing **memory** store so it's searchable, graph-linked, and team-shareable.

## Tech decisions (researched 2026-05-28)

| Capability | Choice | License | Why |
|---|---|---|---|
| Block/rich-text editor | **BlockNote** (`@blocknote/*`, on Tiptap/ProseMirror) | MPL-2.0¹ | Notion-style blocks out of the box; Yjs collab is first-class; rides mature ProseMirror. |
| Real-time collab backend | **Hocuspocus** (`@hocuspocus/server`) in `packages/relay-server` | MIT | Yjs server with auth + Postgres persistence hooks; relay-server (Hono+Node+pg) is the natural home. WS can't live in Next App Router. |
| Collab persistence | Yjs update blob in Postgres (`onStoreDocument`/`onLoadDocument`) | — | No extra lib; the storage hook IS the y-postgres pattern. |
| Mind map | **mind-elixir** + `mind-elixir-react` | MIT | Only option with editable maps + official React wrapper + clean JSON (`getDataString()`) → Postgres `jsonb`. |
| Office docs (.docx/.xlsx) | **DEFER** — view/export only later (SheetJS, mammoth/docx-preview) | Apache/MIT | OnlyOffice/Collabora are AGPL + heavy Docker document servers; overkill for a note app. |

¹ MPL-2.0 is file-level copyleft — safe to consume as a dependency (no app-code contamination), but flagged for legal preference. Fallback if rejected: **Tiptap + custom blocks** (MIT), more build effort.

## Integration with the existing model

A user-authored doc or mind map **is a memory** (a `documents` row), so it automatically inherits
what we already built: `organization_id` scoping, `privacy_level`, and the **"Share with teams"**
multi-team sharing. No parallel storage system.

- New `source_type` values: `doc` (BlockNote) and `mindmap` (mind-elixir).
- Editor content stored as **JSON** in `documents.content` (BlockNote block JSON / mind-elixir data),
  with a `content_format` hint in `metadata` (`'blocknote' | 'mindmap' | 'text' | ...`).
- Search / MCP / knowledge-graph keep consuming a **plain-text projection** of the doc (serialize
  BlockNote → markdown/plaintext on save) so existing features don't change.

### Source-of-truth rule (the main risk)
While a doc is open for live editing, the **Yjs CRDT blob is the source of truth**. On a debounced
save (and on last-collaborator-disconnect), serialize it to `documents.content` (JSON) + a plaintext
projection for search. The JSON/plaintext in `documents` is the source of truth for memory/search/graph
when the doc is **not** being edited. Define cadence up front to avoid drift.

## Phases

- **P1 — Single-user block editor (foundation, no WS server).**
  Add BlockNote to `apps/web`. New `source_type='doc'`. "New document" entry point + an editor
  surface (full-page route and/or detail panel). Create/load/save to `documents` as JSON via the
  existing ingest/PATCH paths; store a plaintext projection for search. Show docs in the memory list;
  they're team-shareable via the dialog we already shipped. Verify tsc + runtime (create/edit/save/reopen).

- **P2 — Real-time collaboration.**
  Stand up Hocuspocus inside `packages/relay-server` (WS upgrade + auth from session/MCP, org-scoped
  room = document id). Persist Yjs updates to Postgres (`doc_yupdates` table or `documents.ydoc BYTEA`).
  Wrap the same BlockNote editor with a Yjs doc + `HocuspocusProvider` (additive — P1 editor unchanged).
  Presence cursors. Reconcile to `documents.content` per the source-of-truth rule.

- **P3 — Mind maps.**
  `mind-elixir` + React wrapper. New `source_type='mindmap'`, data as `jsonb`. Editor surface + save/load.
  Reuse memory list + team sharing. (Collab on mind maps is a later stretch.)

- **P4 — DEFERRED — office docs.**
  Upload + view + export only (SheetJS for sheets, mammoth/docx-preview for Word, export to PDF/markdown).
  Revisit a self-hosted OnlyOffice iframe only on real demand.

## Open questions for the user (can redirect between loop iterations)
1. MPL-2.0 (BlockNote) acceptable, or require MIT-only (→ Tiptap + custom blocks)?
2. Is real-time collab (P2) needed soon, or is single-user authoring + team visibility (P1) enough for now?
3. Office-doc editing — confirm defer.
