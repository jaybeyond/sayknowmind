# AGENTS.md — SayKnowMind Codebase Guide

> For AI agents working on this codebase. Updated: 2026-03-21.

## Project Overview

SayKnowMind is an open-source **Agentic Second Brain** — a full-stack knowledge management platform with AI-powered search, graph visualization, multi-language support, and decentralized sharing.

**Monorepo** managed with pnpm workspaces.

---

## Architecture

```
apps/
  web/          — Next.js 16 + React 19 frontend (port 3000)
  ai-server/    — NestJS AI backend (port 4000)
  dashboard/    — Separate analytics dashboard (Next.js)
  desktop/      — Tauri desktop wrapper (skeletal)
  mobile/       — Capacitor mobile wrapper (skeletal)

packages/
  mcp-server/   — Model Context Protocol server (port 8082)
  sdk-go/       — Go SDK
  sdk-python/   — Python SDK
  sdk-sayknowmind/ — TypeScript SDK
  edgequake/    — Rust RAG engine (port 8080) [external binary]
  zeroclaw/     — Rust agent runtime (port 8081) [external binary]

db/
  init/         — PostgreSQL init scripts (run by Docker on startup)
  migrations/   — Schema migrations
```

---

## Service Ports

| Service      | Port  | Notes                          |
|-------------|-------|--------------------------------|
| Web App     | 3000  | Next.js                        |
| AI Server   | 4000  | NestJS, calls Ollama/OpenRouter|
| EdgeQuake   | 8080  | Rust RAG + vector search       |
| ZeroClaw    | 8081  | Rust agent runtime             |
| MCP Server  | 8082  | Model Context Protocol         |
| PostgreSQL  | 5432  | pgvector + Apache AGE          |
| Ollama      | 11434 | Local LLM (Docker)             |

---

## Tech Stack (apps/web)

- **Framework**: Next.js 16, React 19, TypeScript
- **Styling**: Tailwind CSS v4, shadcn/ui (Radix UI)
- **Auth**: better-auth with JWT plugin (`lib/auth.ts`, `lib/auth-client.ts`)
- **DB**: PostgreSQL via `pg` pool (`lib/db.ts`)
- **State**: Zustand stores (`store/`)
- **i18n**: Custom next-intl-like setup (`lib/i18n.ts`, `messages/`)
- **Tests**: Vitest (`__tests__/`, `vitest.config.ts`)

---

## API Routes (apps/web/app/api/)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/[...all] | No | better-auth handler |
| GET/POST | /api/cap/challenge | No | CAPTCHA challenge |
| POST | /api/cap/redeem | No | CAPTCHA token verification |
| GET | /api/documents | Yes | List documents (paginated) |
| GET/PATCH/DELETE | /api/documents/[id] | Yes | Single document CRUD |
| GET/POST | /api/categories | Yes | List/create categories |
| GET/PUT/DELETE | /api/categories/[id] | Yes | Single category CRUD |
| POST | /api/categories/merge | Yes | Merge two categories |
| GET | /api/categories/suggest/[documentId] | Yes | AI category suggestion |
| POST | /api/chat | Yes | Chat with knowledge base (SSE supported) |
| POST | /api/search | Yes | RAG search via EdgeQuake |
| POST | /api/ingest/url | Yes | Ingest URL |
| POST | /api/ingest/file | Yes | Ingest file upload |
| POST | /api/ingest/text | Yes | Ingest raw text |
| POST | /api/ingest/extension | Yes | Browser extension ingest |
| GET | /api/ingest/status/[jobId] | Yes | Async job status |
| GET | /api/knowledge/graph | Yes | Knowledge graph nodes+edges |
| GET | /api/knowledge/node/[nodeId] | Yes | Node detail + connected docs |
| GET | /api/health | No | Health check |

---

## Real Implementations ✅

These are fully wired to real services — do NOT replace with mocks:

| File | What it does |
|------|-------------|
| `lib/db.ts` | PostgreSQL connection pool (singleton) |
| `lib/auth.ts` | better-auth server config with JWT, rate limiting |
| `lib/auth-client.ts` | better-auth React client (`useSession`, `signIn`, `signOut`) |
| `lib/edgequake/client.ts` | EdgeQuake Rust service client (query, graph, stream) |
| `lib/ingest/ai-processor.ts` | AI server calls for summary + entity extraction + category suggestion |
| `lib/ingest/document-store.ts` | Real DB inserts for documents, entities, categories |
| `lib/ingest/parsers.ts` | File parsing (PDF, DOCX, MD, HTML, TXT) |
| `lib/ingest/job-queue.ts` | Async job tracking via PostgreSQL |
| `lib/ingest/url-fetcher.ts` | URL crawling and content extraction |
| `lib/antibot.ts` | IP/user rate limiting + bot detection |
| `lib/encryption.ts` | AES-256-GCM encryption with per-user keys |
| `lib/private-mode.ts` | Private mode state + guards |
| `lib/fault-recovery.ts` | DB reconnect + query retry logic |
| `lib/categories/store.ts` | Category CRUD against PostgreSQL |
| `app/api/documents/` | Real DB document operations |
| `app/api/search/` | EdgeQuake + PostgreSQL fallback |
| `app/api/chat/` | AI server + RAG + streaming SSE |
| `app/api/categories/` | Category CRUD + tree/graph builder |
| `app/api/ingest/` | Full ingestion pipeline |
| `app/api/knowledge/` | Knowledge graph from EdgeQuake |
| `components/knowledge/` | Knowledge graph visualization (real API calls) |
| `components/categories/` | Category tree + graph (real API) |

---

## Mock / Stub Items 🔴

| File | Issue | Status |
|------|-------|--------|
| `mock-data/bookmarks.ts` | 16 hardcoded bookmarks, 6 collections, 8 tags | Used by sidebar/store — being replaced |
| `store/bookmarks-store.ts` (line 62) | Initializes with `mockBookmarks` | Fixed: init with [] |
| `components/dashboard/sidebar.tsx` (line 53) | Imports mock `collections`, `tags` | Fixed: use real API |
| `components/dashboard/content.tsx` (line 5) | Imports mock `collections`, `tags` | Fixed: use store data |
| `components/dashboard/stats-cards.tsx` (line 5) | Uses mock `collections.length`, `tags.length` | Fixed: use real counts |
| `lib/shared-mode.ts` (encryptWithLit) | Dev-mode fallback — base64 not real encryption | Known limitation, documented |
| `lib/shared-mode.ts` (uploadToArweave) | Throws — Arweave SDK not integrated | Known limitation |
| `apps/desktop/` | Tauri wrapper — skeletal | Future phase |
| `apps/mobile/` | Capacitor wrapper — skeletal | Future phase |

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
// Server: get userId from request session
import { getUserIdFromRequest } from "@/lib/ingest/session-helper";
const userId = await getUserIdFromRequest();
if (!userId) return 401;

// Client: get session
import { useSession } from "@/lib/auth-client";
const { data: session } = useSession();
```

### DB Queries
```ts
import { pool } from "@/lib/db";
const result = await pool.query("SELECT * FROM documents WHERE user_id = $1", [userId]);
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

---

## Testing

```bash
cd apps/web
pnpm test          # Run all Vitest tests
pnpm test:watch    # Watch mode
```

Test files: `apps/web/__tests__/p*.test.ts` — property-based tests using fast-check.

---

## Docker

```bash
docker compose up -d        # Start all services
docker compose logs -f web  # Tail web logs
```

PostgreSQL init runs automatically from `db/init/` scripts on first start.

---

## Commit Convention

```
feat(scope): description
fix(scope): description
docs(scope): description
refactor(scope): description
test(scope): description
```
