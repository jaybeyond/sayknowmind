# AGENTS.md — SayKnowMind Codebase Guide

> For AI agents working on this codebase. Updated: 2026-06-16.

## Project Overview

SayKnowMind is an open-source **Agentic Second Brain** — a full-stack, local-first knowledge management platform with AI-powered search, knowledge-graph visualization, real-time collaborative editing (docs/sheets/mindmaps), multi-language support, and decentralized sharing.

**Monorepo** managed with pnpm workspaces. Currently v0.1.0-alpha but deployed and running in production (EC2, `sayknowmind.ypai.click`).

Active branch: `feat/collab-docs-mindmaps-rag`.

---

## Architecture

```
apps/
  web/          — Next.js 16 + React 19 frontend (port 5400 dev, 3000 conventional)
  ai-server/    — NestJS AI backend (port 4000)
  dashboard/    — Separate analytics dashboard (Next.js)
  desktop/      — Tauri desktop wrapper (active, ships full + lite variants, v0.1.5)
  mobile/       — Capacitor mobile wrapper (skeletal)

packages/
  relay-server/    — Hocuspocus collab backend + encrypted offline-sync relay (port 3200)
  mcp-server/      — Model Context Protocol server (port 8082)
  edgequake/       — Rust RAG engine (port 8080), 9 crates [external binary]
  sdk-go/          — Go SDK
  sdk-python/      — Python SDK
  sdk-sayknowmind/ — TypeScript SDK
  sdk/             — Legacy/standalone TS SDK

db/
  init/         — PostgreSQL init scripts (run by Docker on startup)
  migrations/   — Schema migrations (061+ as of this writing)
```

> Note: **ZeroClaw** (Rust agent runtime, port 8081) is referenced by docs/architecture but ships as an external binary — there is no `packages/zeroclaw/` in this repo. Agent orchestration in-repo lives in `apps/web/lib/agents/`.

---

## Service Ports

| Service      | Port  | Notes                                  |
|-------------|-------|----------------------------------------|
| Web App     | 5400 (dev) | Next.js (`pnpm dev`); 3000 conventional |
| AI Server   | 4000  | NestJS, calls Ollama/OpenRouter         |
| Relay Server| 3200  | Hocuspocus `/collab` WS + sync relay    |
| EdgeQuake   | 8080  | Rust RAG + vector + graph search        |
| ZeroClaw    | 8081  | Rust agent runtime (external binary)    |
| MCP Server  | 8082  | Model Context Protocol                  |
| PostgreSQL  | 5432  | pgvector + Apache AGE                   |
| Ollama      | 11434 | Local LLM (Docker)                      |
| SearXNG     | 8888  | Meta search (optional)                  |

---

## Tech Stack (apps/web)

- **Framework**: Next.js 16, React 19, TypeScript
- **Styling**: Tailwind CSS v4, shadcn/ui (Radix UI)
- **Auth**: better-auth with JWT (`lib/auth.ts`, `lib/auth-client.ts`); dual edition via `NEXT_PUBLIC_AUTH_MODE` (`saas` delegates login to SayKnowWork SaaS, `local` self-hosted) — see `lib/auth-mode.ts`, `lib/saas-auth.ts`
- **DB**: PostgreSQL via `pg` pool (`lib/db.ts`); in-browser pglite fallback (`lib/db-pglite.ts`)
- **State**: Zustand stores (`store/`)
- **Editors**: BlockNote (notes), Univer (sheets), mind-elixir (mindmaps) — multi-tab editor
- **Realtime collab**: Yjs CRDT + @hocuspocus/provider, persisted to Postgres `doc_collab` via relay-server
- **Graph viz**: Sigma.js + graphology (knowledge graph), React Flow / `@xyflow` (category graph), react-force-graph-2d
- **i18n**: Custom next-intl-like setup (`lib/i18n.ts`, `messages/`) — ko / en / zh / ja
- **Tests**: Vitest (`__tests__/`, `vitest.config.ts`), property-based via fast-check

---

## API Routes (apps/web/app/api/)

Auth = requires session/bearer unless noted. 33+ route groups; key ones:

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/[...all] | No | better-auth handler |
| POST | /api/auth/external-login | No | SaaS-delegated login (saas edition) |
| GET/POST | /api/cap/challenge, /api/cap/redeem | No | PoW CAPTCHA challenge / verify |
| GET | /api/health | No | Health check |
| GET | /api/services/status | Yes | Engine/service status |
| GET | /api/documents, /api/documents/[id] | Yes | Document list / CRUD (PATCH auto-captures version) |
| GET | /api/documents/trash, /reprocess, /sync-edgequake | Yes | Trash, reprocess, EdgeQuake sync |
| GET/POST | /api/docs, /api/docs/[id]/versions | Yes | Collab docs + version history (list + restore) |
| GET/POST | /api/categories, /api/categories/[id] | Yes | Category CRUD |
| POST | /api/categories/merge | Yes | Merge categories |
| GET | /api/categories/suggest/[documentId] | Yes | AI category suggestion |
| GET/POST | /api/tags | Yes | Tag CRUD |
| POST | /api/chat | Yes | Chat with knowledge base (SSE) |
| GET/POST | /api/conversations, /api/conversations/[id] | Yes | Chat history |
| POST | /api/search | Yes | RAG search via EdgeQuake (+ Postgres fallback) |
| POST | /api/ingest/{url,file,text,extension,bookmarks} | Yes | Ingestion pipeline |
| GET | /api/ingest/status/[jobId] | Yes | Async job status |
| POST | /api/pipeline | Yes | UltraRAG pipeline execution |
| GET | /api/knowledge/graph, /api/knowledge/node/[nodeId] | Yes | Knowledge graph + node detail |
| GET | /api/insights | Yes | Dashboard insights widgets |
| GET/POST | /api/share, /api/shares, /api/invitations/[id] | Yes | Sharing + team invitations |
| GET | /api/s/[token] (page), /api/og/[id] | Mixed | Public shared view + OG image |
| * | /api/integrations/{telegram,codex,ocp,connectors,[channel]} | Yes | Channel integrations |
| * | /api/llm-relay/{poll,respond} | Yes | Browser-side LLM relay queue |
| GET/POST | /api/sync/{relay,status} | Yes | Offline sync via relay-server |
| GET/POST | /api/models/* (active, pull, embedding, provider, health) | Yes | Ollama/provider model mgmt |
| GET/POST | /api/settings/{providers,prompts} | Yes | Provider + prompt settings |
| GET/POST | /api/user/{me,mcp-key,mcp-audit} | Yes | User profile + MCP API keys |
| GET | /api/notifications, /api/notifications/stream | Yes | Notifications (SSE) |
| GET | /api/events/stream | Yes | Document/event SSE stream |
| GET | /api/backup, /api/usage | Yes | Backup scheduler, usage limits |
| GET/POST | /api/admin/{users,stats} | Yes (admin) | Admin panel |
| GET | /api/desktop/runtime, /api/files/[id] | Yes | Desktop runtime, file serving |

---

## Real Implementations ✅

Fully wired to real services — do NOT replace with mocks:

| File | What it does |
|------|-------------|
| `lib/db.ts` | PostgreSQL connection pool (singleton) |
| `lib/auth.ts` | better-auth server config (JWT, rate limiting) |
| `lib/auth-mode.ts` / `lib/saas-auth.ts` | Dual-edition auth (saas delegated / local) |
| `lib/auth-client.ts` | better-auth React client |
| `lib/org-context.ts` | Multi-tenant org/workspace context — isolation is **app-layer only** via `getOrgContext()` + `readableClause`/`writableClause`; Postgres RLS is **inert** (single superuser pool, `tenant_id IS NULL` escape, GUC never set). **The DB does not back-stop isolation** — a missing WHERE clause is a cross-tenant exposure. |
| `lib/edgequake/client.ts` | EdgeQuake Rust client (query, graph, stream) |
| `lib/agents/pipeline.ts` | Agent ingestion/processing pipeline (large, core) |
| `lib/agents/doc-actions.ts` | Agent-driven doc/sheet/mindmap create + share |
| `lib/agents/chat-router.ts` | Agent chat routing (active, has callers) |
| `lib/agents/orchestrator.ts` | ⚠️ Dead/no-caller — not wired to any active route; safe to remove or replace |
| `lib/agents/langgraph.ts` | ⚠️ Dead/no-caller — LangGraph bindings unused in active code; safe to remove or replace |
| `lib/ultrarag/{executor,parser,validator}.ts` | UltraRAG YAML pipeline engine |
| `lib/ingest/ai-processor.ts` | AI server calls (summary, entities, category) |
| `lib/ingest/document-store.ts` | Real DB inserts for docs/entities/categories |
| `lib/ingest/job-queue.ts` | Async job tracking via PostgreSQL |
| `lib/ingest/{parsers,url-fetcher,bookmark-parser}.ts` | File/URL/bookmark parsing |
| `lib/versions/store.ts` | Auto version capture + restore (notes/sheets/mindmaps) |
| `lib/collab/token.ts` | Collab WS token (user id + avatar for presence) |
| `lib/relay/{sync-service,client,conflict-resolver}.ts` | Offline sync via relay-server |
| `lib/office/sheet-export.ts` | Full-fidelity XLSX/CSV export (styles, formulas, merges) |
| `lib/zvec/engine.ts` | ⚠️ Dead/no-caller — in-process vector engine exists but has no active callers in current routes; safe to remove or replace |
| `lib/antibot.ts` | IP/user rate limiting + bot detection |
| `lib/encryption.ts` | AES-256-GCM with per-user keys |
| `lib/private-mode.ts` | Private mode state + guards |
| `lib/fault-recovery.ts` | DB reconnect + query retry |
| `lib/categories/store.ts` / `lib/tags/store.ts` | Category/tag CRUD against Postgres |
| `lib/integrations/telegram.ts` / `channels.ts` | Telegram + channel ingestion |
| `app/api/*` | See route table — all backed by real DB/services |
| `components/knowledge/`, `components/categories/` | Graph viz with real API calls |

---

## Mock / Stub Items 🔴

| File | Issue | Status |
|------|-------|--------|
| `lib/shared-mode.ts` (encryptWithLit) | Dev-mode fallback — base64, not real Lit encryption | Known limitation, gated by `LIT_DEV_MODE` |
| `lib/shared-mode.ts` (uploadToArweave) | Throws — Arweave SDK not integrated | Known limitation |
| `mock-data/bookmarks.ts` | Legacy hardcoded fixtures | Stores init from real API; verify before reusing |
| `apps/mobile/` | Capacitor wrapper | Skeletal / future phase |

> `apps/desktop/` is no longer skeletal — Tauri app ships full + lite variants (v0.1.5) with CI builds.

---

## Environment Variables (apps/web)

```env
DATABASE_URL=postgres://postgres:password@localhost:5432/sayknowmind
# OR individual parts:
POSTGRES_USER=postgres
POSTGRES_PASSWORD=password
POSTGRES_PORT=5432

EDGEQUAKE_URL=http://localhost:8080
EDGEQUAKE_API_KEY=

AI_SERVER_URL=http://localhost:4000
AI_API_KEY=

NEXT_PUBLIC_APP_URL=http://localhost:3000
TRUSTED_ORIGINS=http://localhost:3000

# Auth edition: "saas" (delegate to SayKnowWork) | "local" (self-hosted). Default: saas
NEXT_PUBLIC_AUTH_MODE=local

# Realtime collab (relay-server)
NEXT_PUBLIC_COLLAB_WS_URL=ws://localhost:3200/collab

# Optional
REQUIRE_EMAIL_VERIFICATION=false
LIT_DEV_MODE=true   # Set to false for production Lit Protocol
LIT_API_KEY=
LIT_NETWORK=datil-dev
```

---

## Key Patterns

### Authentication
```ts
// Server: get userId from session OR MCP API key (bearer)
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
const userId = await getUserIdFromRequest();
if (!userId) return 401;

// Client: get session
import { useSession } from "@/lib/auth-client";
const { data: session } = useSession();

// Edition check
import { isSaasAuth } from "@/lib/auth-mode";
```

### DB Queries
```ts
import { pool } from "@/lib/db";
const result = await pool.query("SELECT * FROM documents WHERE user_id = $1", [userId]);
// NOTE: a bound param ($1) that is never referenced in the SQL triggers Postgres 42P18
// (indeterminate type). Anchor unused-but-bound params, e.g. `$1::text IS NOT NULL`.
```

### EdgeQuake Search
```ts
import { queryEdgeQuake } from "@/lib/edgequake/client";
const result = await queryEdgeQuake({ query, mode: "hybrid", include_references: true });
```

### Rate Limiting
```ts
import { checkAntiBot } from "@/lib/antibot";
const blocked = checkAntiBot(request, userId);
if (blocked) return blocked;
```

### Document Versioning
```ts
// Versions are auto-captured in the document PATCH handler (30s throttle,
// skip-if-identical, 50-version retention, author recorded).
import { captureVersion } from "@/lib/versions/store";
```

---

## Testing

```bash
cd apps/web
pnpm test          # Run all Vitest tests
pnpm test:watch    # Watch mode

cd packages/mcp-server && npm test   # MCP server tests
```

Test files: `apps/web/__tests__/p*.test.ts` — property-based tests using fast-check (28+ suites). EdgeQuake crates have per-crate `tests/`.

---

## Docker

```bash
docker compose up -d        # Start all services
docker compose logs -f web  # Tail web logs
```

PostgreSQL init runs automatically from `db/init/` scripts on first start. Migrations live in `db/migrations/NNN_*.sql`; apply with `db/migrations/scripts/migrate.sh`.

---

## Commit Convention

```
feat(scope): description
fix(scope): description
docs(scope): description
refactor(scope): description
test(scope): description
```
