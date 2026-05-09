# SayKnowMind — Agentic Second Brain

> **"Everything you say, we know, and mind forever."**

**Read this in other languages:**
[한국어](./INTRO.ko.md) · [简体中文](./INTRO.zh-CN.md) · [繁體中文](./INTRO.zh-TW.md) · [日本語](./INTRO.ja.md)

---

**SayKnowMind** is an open-source **personal Agentic Second Brain** — an AI-powered knowledge platform that captures, organizes, and retrieves everything you read, watch, write, and discuss, so it becomes a memory you can query at any time.

## Three Core Principles

1. **Local-First**
   All data is stored on your own machine by default. Turn on **Private Mode** and *zero* external network calls are made — your knowledge belongs only to you.

2. **Agentic Intelligence**
   Multiple AI agents auto-classify, extract, summarize, and link your content. No manual tagging — the knowledge graph builds itself as you capture.

3. **Cross-Platform**
   Web · Desktop (macOS / Windows / Linux via Tauri) · Mobile (iOS / Android via Capacitor) · MCP Server · SDKs (TypeScript / Python / Go) · Telegram bot ingestion.

## Technical Highlights — 3-Layer RAG Stack

| Layer | Engine | Role |
|------|--------|------|
| L1 | **EdgeQuake** (Rust) | High-performance search engine combining Apache AGE (graph) + pgvector (vector) with 6 query modes |
| L2 | **UltraRAG** | Agentic RAG pipeline — auto-categorization, ZeroClaw wrapping, MCP Skills via YAML |
| L3 | **zvec** | Ultra-light in-process vector engine for hybrid search acceleration |

## Who It's For

- People who want a personal knowledge base **without uploading their data to Notion / ChatGPT / cloud-only services**
- Researchers, developers, and content creators drowning in tabs, screenshots, and bookmarks who need an AI that *actually remembers*
- Teams that want **self-hosted** deployment (Docker / Kubernetes / Railway) with full data sovereignty

## Open Source & Free

Apache 2.0 license — 100% open source, free forever. Mirrored on both GitHub and GitLab. Contributions welcome.

---

**Learn more:**
[Project README](../../README.md) · [Architecture](../../README.md#architecture) · [Getting Started](../../README.md#getting-started) · [Helm Chart for Kubernetes](../../deploy/helm/sayknowmind/README.md)
