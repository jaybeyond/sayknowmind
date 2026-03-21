<p align="center">
  <img src="https://img.shields.io/badge/version-v0.1.0--alpha-blue" alt="Version" />
  <img src="https://img.shields.io/badge/license-Apache%202.0-green" alt="License" />
  <img src="https://img.shields.io/badge/Next.js-16-black" alt="Next.js" />
  <img src="https://img.shields.io/badge/React-19-61DAFB" alt="React" />
  <img src="https://img.shields.io/badge/Rust-EdgeQuake-orange" alt="Rust" />
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED" alt="Docker" />
</p>

# SayKnowMind — Agentic Second Brain

> **"Everything you say, we know, and mind forever."**

SayKnowMind is an open-source Personal Agentic Second Brain platform. It captures, organizes, and retrieves all your knowledge with a local-first architecture, multi-agent orchestration, and cross-platform accessibility.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Features](#features)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Development](#development)
- [API Reference](#api-reference)
- [SDKs](#sdks)
- [MCP Server](#mcp-server)
- [Docker Services](#docker-services)
- [Database Schema](#database-schema)
- [Progress Status](#progress-status)
- [Roadmap](#roadmap)
- [License](#license)

---

## Overview

SayKnowMind is a full-stack, cross-platform knowledge management system built on a **3-Layer RAG Stack**:

| Layer | Engine | Role |
|-------|--------|------|
| **Layer 1** | **EdgeQuake** (Rust) | High-performance search engine — Apache AGE (graph) + pgvector (vector), 6 query modes |
| **Layer 2** | **UltraRAG** | Agentic RAG pipeline — auto-categorization, ZeroClaw wrapping, MCP Skills via YAML |
| **Layer 3** | **zvec** | Ultra-lightweight in-process vector engine for hybrid search |

### Key Principles

- **Local-First (Private Mode)**: All data stored locally. Zero external network calls when activated.
- **Agentic Intelligence**: Multi-agent orchestration for complex knowledge processing tasks.
- **Cross-Platform**: Web, Desktop (Tauri), Mobile (Capacitor), MCP Server, SDKs (TS/Python/Go).
- **Open Source**: Apache 2.0 license. 100% free.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Layer                             │
│  ┌──────────┐  ┌──────────────┐  ┌───────────┐  ┌───────────┐  │
│  │ Web App  │  │ Desktop App  │  │Mobile App │  │ SDKs      │  │
│  │ Next.js  │  │   Tauri      │  │Capacitor  │  │TS/Py/Go   │  │
│  │ :3000    │  │              │  │           │  │           │  │
│  └────┬─────┘  └──────┬───────┘  └─────┬─────┘  └─────┬─────┘  │
└───────┼────────────────┼────────────────┼──────────────┼────────┘
        │                │                │              │
┌───────▼────────────────▼────────────────▼──────────────▼────────┐
│                         API Layer                               │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  REST API Routes (/api/ingest, /api/search, /api/chat,    │  │
│  │   /api/categories, /api/documents, /api/knowledge)        │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌──────────────────┐  ┌──────────────────────────────────────┐  │
│  │  Auth Middleware  │  │  MCP Server :8082 (JSON-RPC 2.0)    │  │
│  │  (better-auth)   │  │  Claude/ChatGPT/Cursor Integration  │  │
│  └──────────────────┘  └──────────────────────────────────────┘  │
└─────────────────────────────┬───────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────────┐
│                      Engine Layer                               │
│  ┌─────────────────┐  ┌──────────────┐  ┌────────────────────┐  │
│  │  EdgeQuake :8080 │  │ AI Server    │  │  ZeroClaw :8081    │  │
│  │  Rust Search     │  │ :4000        │  │  Rust Agent        │  │
│  │  6 Query Modes   │  │ LLM Routing  │  │  Runtime           │  │
│  └────────┬─────────┘  └──────┬───────┘  └────────────────────┘  │
└───────────┼────────────────────┼────────────────────────────────┘
            │                    │
┌───────────▼────────────────────▼────────────────────────────────┐
│                    Data & AI Layer                              │
│  ┌───────────────────┐  ┌────────────┐  ┌────────────────────┐  │
│  │ PostgreSQL :5432  │  │ Ollama     │  │ SearXNG :8888      │  │
│  │ + pgvector        │  │ :11434     │  │ Meta Search        │  │
│  │ + Apache AGE      │  │ Local LLM  │  │                    │  │
│  └───────────────────┘  └────────────┘  └────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Category | Technology |
|----------|-----------|
| **Frontend** | Next.js 16, React 19, Tailwind CSS, shadcn/ui |
| **Search Engine** | EdgeQuake (Rust), Apache AGE, pgvector |
| **AI Server** | sayknow-ai-server (OpenRouter, Ollama, WebLLM cascade) |
| **Agent Runtime** | ZeroClaw (Rust), LangGraph Orchestrator |
| **Database** | PostgreSQL 16 + pgvector + Apache AGE |
| **Authentication** | better-auth (email/password, JWT, session management) |
| **Desktop** | Tauri (Windows/macOS/Linux) |
| **Mobile** | Capacitor (Android/iOS) |
| **MCP** | @modelcontextprotocol/sdk (JSON-RPC 2.0) |
| **SDKs** | TypeScript, Python (httpx), Go |
| **Encryption** | AES-256-GCM (per-user key derivation) |
| **i18n** | Korean, English (next-intl) |
| **Graph Viz** | Sigma.js (knowledge graph), React Flow (category graph) |
| **Deployment** | Docker Compose (9 services) |
| **License** | Apache 2.0 |

---

## Project Structure

```
sayknowmind/
├── apps/
│   ├── web/                    # Next.js 16 main web application
│   │   ├── app/
│   │   │   ├── (auth)/         # Login / Signup pages
│   │   │   ├── api/
│   │   │   │   ├── auth/       # better-auth routes
│   │   │   │   ├── cap/        # AntiBot PoW CAPTCHA
│   │   │   │   ├── categories/ # CRUD + merge + suggest
│   │   │   │   ├── chat/       # Streaming chat (SSE)
│   │   │   │   ├── documents/  # Document CRUD
│   │   │   │   ├── health/     # Health check
│   │   │   │   ├── ingest/     # URL / File / Text / Extension ingestion
│   │   │   │   ├── knowledge/  # Graph + Node detail
│   │   │   │   └── search/     # EdgeQuake search with citations
│   │   │   ├── categories/     # Category management page
│   │   │   ├── knowledge/      # Knowledge graph page
│   │   │   └── ...             # Dashboard, Archive, Favorites, Trash
│   │   ├── components/
│   │   │   ├── categories/     # CategoryManager, Tree, Graph
│   │   │   ├── dashboard/      # Header, Sidebar, Content, BookmarkCard
│   │   │   ├── knowledge/      # GraphCanvas (Sigma.js), NodeDetailPanel
│   │   │   └── ui/             # shadcn/ui components
│   │   ├── lib/
│   │   │   ├── agents/         # Agentic orchestrator (multi-step reasoning)
│   │   │   ├── categories/     # Category state management
│   │   │   ├── edgequake/      # EdgeQuake Rust engine client
│   │   │   ├── ingest/         # URL fetcher, AI processor, parsers, job queue
│   │   │   ├── auth.ts         # better-auth server config
│   │   │   ├── antibot.ts      # PoW CAPTCHA + bot detection
│   │   │   ├── db.ts           # PostgreSQL connection pool
│   │   │   ├── encryption.ts   # AES-256-GCM encryption
│   │   │   ├── fault-recovery.ts  # Auto-reconnect, query timeout
│   │   │   ├── private-mode.ts # Network isolation, telemetry blocking
│   │   │   ├── shared-mode.ts  # IPFS/Arweave/Ceramic sharing
│   │   │   ├── sync.ts         # Tailscale + Syncthing sync
│   │   │   └── types.ts        # Domain type definitions
│   │   ├── messages/           # i18n (en.json, ko.json)
│   │   ├── __tests__/          # 20 property-based test files (Vitest + fast-check)
│   │   └── middleware.ts       # Auth guard for all API routes
│   ├── ai-server/              # sayknow-ai-server (LLM routing engine)
│   ├── dashboard/              # EdgeQuake RAG dashboard (port 3001)
│   ├── desktop/                # Tauri desktop app shell
│   └── mobile/                 # Capacitor mobile app shell
├── packages/
│   ├── edgequake/              # Rust search engine (upstream)
│   ├── mcp-server/             # MCP Server (6 tool groups)
│   │   └── src/tools/          # health, document, query, graph, workspace, sayknowmind
│   ├── sdk/                    # EdgeQuake TypeScript SDK (upstream)
│   ├── sdk-sayknowmind/        # SayKnowMind TypeScript SDK
│   ├── sdk-python/             # SayKnowMind Python SDK (httpx)
│   ├── sdk-go/                 # SayKnowMind Go SDK
│   └── zeroclaw/               # Rust agent runtime
├── db/
│   ├── init/
│   │   ├── 01-edgequake-init.sql   # EdgeQuake schema
│   │   ├── 02-init-age-db.sh       # Apache AGE graph DB setup
│   │   ├── 03-init-extensions.sql  # pgvector + AGE extensions
│   │   ├── 04-sayknowmind-init.sql # Core schema (10 tables)
│   │   ├── 05-ingestion-jobs.sql   # Ingestion job tracking
│   │   └── 06-privacy-levels.sql   # Document privacy levels
│   └── migrations/             # Database migrations
├── docker/
│   ├── Dockerfile.postgres     # PostgreSQL + pgvector + Apache AGE
│   ├── Dockerfile.dashboard    # Dashboard build
│   └── Dockerfile.edgequake    # EdgeQuake Rust build
├── docker-compose.yml          # 9-service orchestration
├── install.sh                  # 1-click Docker install script
├── Makefile                    # Development commands
└── LICENSE                     # Apache 2.0
```

---

## Features

### Ingestion Pipeline (Phase A)
- **URL Ingestion**: Paste any URL — content fetched via Mozilla Readability + Cheerio fallback
- **File Upload**: Drag & drop PDF, TXT, MD, HTML, DOCX files
- **Text Input**: Direct text ingestion
- **Browser Extension**: Save pages directly from your browser
- **Auto Processing**: AI-powered summary, entity extraction, category suggestion on every document

### Knowledge Exploration & Chat (Phase B)
- **6 Query Modes**: Local, Global, Hybrid, Drift, Mix, Naive (via EdgeQuake)
- **Streaming Chat**: Real-time SSE streaming responses
- **Agentic Query**: Multi-step reasoning for complex questions (query decomposition → sub-task execution → synthesis)
- **Citation**: Every answer includes source document references
- **Knowledge Graph**: Interactive Sigma.js visualization with zoom, pan, filter

### Category Management (Phase C)
- **Dual View**: Tree hierarchy + React Flow graph visualization
- **Full CRUD**: Create, rename, move (drag & drop), delete categories
- **AI Suggestion**: Agent proposes categories with confidence scores and reasoning
- **Merge**: Combine duplicate categories

### Cross-Platform (Phase D)
- **MCP Server**: Expose SayKnowMind as a skill for Claude, ChatGPT, Cursor, Windsurf
- **SDKs**: TypeScript, Python, Go clients with full API coverage
- **Desktop**: Tauri app with system tray, global shortcuts, auto-update
- **Mobile**: Capacitor app with share intent, push notifications, offline mode

### Privacy & Security
- **Private Mode**: 100% local data, outbound network blocking, telemetry suppression, Ollama LLM fallback
- **Shared Mode**: IPFS + age encryption + Tailscale Discovery for selective sharing
- **AES-256-GCM**: Per-user key derivation encryption for all stored data
- **AntiBot**: Self-hosted PoW CAPTCHA (tiagozip/cap)
- **Auth**: better-auth with 5-attempt lockout, 24h sessions, JWT

---

## Getting Started

### Prerequisites

- Docker & Docker Compose v2+
- 8GB+ RAM (AI server requires 4-8GB)

### Quick Install

```bash
# Clone the repository
git clone https://github.com/your-org/sayknowmind.git
cd sayknowmind

# Run the installer (generates .env, starts all services)
chmod +x install.sh
./install.sh
```

### Manual Setup

```bash
# 1. Copy environment config
cp .env.example .env
# Edit .env with your settings (generate secrets!)

# 2. Start all services
docker compose up -d

# 3. Check status
docker compose ps
```

### Access Points

| Service | URL | Description |
|---------|-----|-------------|
| **Web App** | http://localhost:3000 | Main SayKnowMind interface |
| **Dashboard** | http://localhost:3001 | EdgeQuake RAG dashboard |
| **AI Server** | http://localhost:4000 | LLM routing API |
| **EdgeQuake** | http://localhost:8080 | Search engine API |
| **ZeroClaw** | http://localhost:8081 | Agent runtime API |
| **MCP Server** | http://localhost:8082 | MCP JSON-RPC endpoint |
| **Ollama** | http://localhost:11434 | Local LLM server |
| **SearXNG** | http://localhost:8888 | Meta search engine |

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_USER` | `postgres` | Database user |
| `POSTGRES_PASSWORD` | — | Database password |
| `BETTER_AUTH_SECRET` | — | Auth session secret (generate with `openssl rand -base64 32`) |
| `ENCRYPTION_KEY` | — | AES-256 key (generate with `openssl rand -hex 32`) |
| `AI_SERVER_URL` | `http://localhost:4000` | AI server endpoint |
| `EDGEQUAKE_URL` | `http://localhost:8080` | EdgeQuake endpoint |
| `LLM_PROVIDER` | `ollama` | LLM provider (`ollama` \| `openai`) |
| `LLM_MODEL` | `Qwen/Qwen3.5-0.8B` | Default LLM model |
| `PRIVATE_MODE` | `true` | Enable private mode |
| `OPENROUTER_API_KEY` | — | OpenRouter API key (optional) |
| `OPENAI_API_KEY` | — | OpenAI API key (optional) |

See [`.env.example`](.env.example) for the complete list.

---

## Development

```bash
# Install dependencies
make install

# Run frontend dev server (port 3000)
make dev-web

# Run RAG dashboard dev server (port 3001)
make dev-dashboard

# Run AI server in dev mode (port 4000)
make dev-ai

# Docker commands
make up          # Start all services
make down        # Stop all services
make logs        # Follow logs
make build       # Build Docker images
make clean       # Stop + remove volumes
make db-reset    # Reset database (WARNING: destroys data)
make status      # Show service status
```

### Running Tests

```bash
# Web app property-based tests
cd apps/web && pnpm test

# MCP server tests
cd packages/mcp-server && npm test
```

---

## API Reference

All API endpoints require authentication via `Authorization: Bearer <token>` header (except `/api/health` and `/api/auth/*`).

### Ingestion

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/ingest/url` | Ingest content from a URL |
| `POST` | `/api/ingest/file` | Upload and ingest a file (PDF, TXT, MD, HTML, DOCX) |
| `POST` | `/api/ingest/text` | Ingest raw text content |
| `POST` | `/api/ingest/extension` | Ingest from browser extension |
| `GET` | `/api/ingest/status/:jobId` | Check ingestion job status |

### Search & Chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/search` | Search documents with citations (via EdgeQuake) |
| `POST` | `/api/chat` | Chat with your knowledge base (SSE streaming) |

### Documents

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/documents` | List all documents |
| `GET` | `/api/documents/:id` | Get document details |
| `DELETE` | `/api/documents/:id` | Delete a document |

### Categories

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/categories` | List all categories |
| `POST` | `/api/categories` | Create a category |
| `PUT` | `/api/categories/:id` | Update a category |
| `DELETE` | `/api/categories/:id` | Delete a category |
| `POST` | `/api/categories/merge` | Merge duplicate categories |
| `GET` | `/api/categories/suggest/:documentId` | Get AI category suggestions |

### Knowledge Graph

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/knowledge/graph` | Get knowledge graph data |
| `GET` | `/api/knowledge/node/:nodeId` | Get node details + connected documents |

### System

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check (no auth required) |
| `POST` | `/api/cap/challenge` | Get PoW CAPTCHA challenge |
| `POST` | `/api/cap/redeem` | Verify PoW CAPTCHA solution |

---

## SDKs

### TypeScript

```typescript
import { SayknowMindClient } from '@sayknowmind/sdk';

const client = new SayknowMindClient({
  baseUrl: 'http://localhost:3000',
  apiKey: 'your-api-key',
});

// Search your knowledge base
const results = await client.search('quantum computing applications');

// Ingest a URL
await client.ingestUrl('https://example.com/article');

// Chat with streaming
const stream = client.chatStream('Summarize my notes on AI');
for await (const chunk of stream) {
  process.stdout.write(chunk);
}
```

### Python

```python
from sayknowmind import SayknowMindClient

client = SayknowMindClient(
    base_url="http://localhost:3000",
    api_key="your-api-key",
)

# Search
results = client.search("quantum computing applications")

# Ingest
client.ingest_url("https://example.com/article")

# Chat
response = client.chat("Summarize my notes on AI")
```

### Go

```go
import "github.com/sayknowmind/sdk-go"

client := sayknowmind.NewClient(
    sayknowmind.WithBaseURL("http://localhost:3000"),
    sayknowmind.WithAPIKey("your-api-key"),
)

// Search
results, err := client.Search(ctx, "quantum computing applications")

// Ingest
err = client.IngestURL(ctx, "https://example.com/article")

// Chat
response, err := client.Chat(ctx, "Summarize my notes on AI")
```

---

## MCP Server

SayKnowMind exposes a [Model Context Protocol](https://modelcontextprotocol.io/) server, allowing external AI platforms to access your knowledge base.

### Supported Platforms

- Claude Desktop
- ChatGPT Plugins
- Cursor
- Windsurf

### Available Tools

| Tool | Description |
|------|-------------|
| `sayknowmind.search` | Search the knowledge base |
| `sayknowmind.ingest` | Ingest new content |
| `sayknowmind.document.get` | Retrieve a document |
| `sayknowmind.document.list` | List documents |
| `sayknowmind.graph.query` | Query the knowledge graph |
| `sayknowmind.health` | Check system health |

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "sayknowmind": {
      "command": "npx",
      "args": ["-y", "@sayknowmind/mcp-server"],
      "env": {
        "EDGEQUAKE_URL": "http://localhost:8080",
        "AUTH_SECRET": "your-auth-secret"
      }
    }
  }
}
```

---

## Docker Services

| Service | Image / Build | Port | Purpose |
|---------|--------------|------|---------|
| **postgres** | Custom (pgvector + AGE) | 5432 | Database with vector + graph extensions |
| **edgequake** | Rust build | 8080 | Search engine (6 query modes) |
| **ai-server** | Node.js build | 4000 | LLM routing (OpenRouter/Ollama/WebLLM) |
| **web** | Next.js build | 3000 | Main web application |
| **dashboard** | Next.js build | 3001 | EdgeQuake RAG dashboard |
| **ollama** | `ollama/ollama:latest` | 11434 | Local LLM inference |
| **searxng** | `searxng/searxng:latest` | 8888 | Meta search engine |
| **mcp-server** | Node.js build | 8082 | MCP JSON-RPC server |
| **zeroclaw** | Rust build | 8081 | Agent runtime |

### Resource Requirements

| Service | Memory Limit | Memory Reserved |
|---------|-------------|-----------------|
| **ai-server** | 8 GB | 4 GB |
| Others | Default | Default |

---

## Database Schema

Core tables in PostgreSQL (with pgvector + Apache AGE extensions):

| Table | Description |
|-------|-------------|
| `users` | User accounts and profiles |
| `documents` | Ingested content (URL, file, text) |
| `entities` | Auto-extracted entities (people, orgs, concepts) |
| `categories` | Hierarchical knowledge categories |
| `document_categories` | Document-category assignments |
| `vectors` | pgvector embeddings (ivfflat index) |
| `graph_nodes` | Knowledge graph nodes |
| `graph_edges` | Knowledge graph relationships |
| `conversations` | Chat conversation sessions |
| `messages` | Chat messages within conversations |
| `shared_content` | Shared document metadata (IPFS CID, permissions) |
| `ingestion_jobs` | Async ingestion job tracking |
| `privacy_levels` | Document privacy level definitions |

---

## Progress Status

### v0.1.0-alpha — Overall: ~63%

| Area | Status | Completion |
|------|--------|------------|
| Frontend (Next.js, branding, i18n) | Functional | 85% |
| Authentication (better-auth, JWT) | Functional | 90% |
| AntiBot (PoW CAPTCHA) | Functional | 75% |
| Ingestion Pipeline (URL/File/Text/Extension) | Functional | 80% |
| Knowledge Exploration + Chat (EdgeQuake, SSE) | Functional | 75% |
| RAG Dashboard + Graph (Sigma.js) | Functional | 70% |
| Category Management (Tree + Graph, AI suggest) | Functional | 75% |
| MCP Server (tool registration, partial wire-up) | Partial | 50% |
| SDKs (TypeScript, Python, Go) | Implemented | 85% |
| Private Mode (app-level isolation) | Partial | 60% |
| Shared Mode (Lit Protocol placeholder) | Scaffold | 40% |
| Desktop App (Tauri config only) | Scaffold | 25% |
| Mobile App (Capacitor config only) | Scaffold | 15% |
| Agent Runtime (TS orchestrator, not ZeroClaw) | Partial | 50% |
| Docker Deployment (9 services, install.sh) | Functional | 80% |
| Non-functional (encryption, fault recovery) | Partial | 65% |
| Property-based Tests (mock simulations) | Structural | 60% |

### Known Gaps

1. **Shared Mode**: Lit Protocol SDK not actually wired — placeholder implementations
2. **Desktop/Mobile**: Config files only, no native feature logic
3. **Private Mode**: Docker-level network isolation (iptables) not implemented
4. **MCP Server**: EdgeQuake/Ingestion Pipeline wire-up incomplete
5. **ZeroClaw**: Rust agent pipeline not connected — TypeScript orchestrator fills this role

---

## Roadmap

### v0.1.0 (Current Target)
- [ ] Complete MCP Server → EdgeQuake wire-up
- [ ] Docker-level Private Mode network isolation
- [ ] Shared Mode with actual IPFS Kubo + age encryption
- [ ] Tauri desktop app with auto-start and global shortcuts
- [ ] Capacitor mobile app with share intent
- [ ] Live integration tests (replace mock simulations)
- [ ] SDK documentation and package publishing

### v0.2.0 (Planned)
- [ ] UltraRAG YAML pipeline framework
- [ ] ZeroClaw Rust agent pipeline integration
- [ ] Browser extension (Chrome/Firefox)
- [ ] Multi-user workspace support
- [ ] Auto-backup and scheduled snapshots
- [ ] Additional languages (Japanese, Chinese)

---

## License

```
Copyright 2024-2026 Raphael MANSUY

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0
```

See [LICENSE](LICENSE) for the full text.
