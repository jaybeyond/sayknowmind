# SayKnowMind Frontend — Full Implementation Plan

**Date:** 2026-03-22
**Model:** claude-opus-4-6
**Scope:** All frontend pages production-ready, multi-type ingestion, AI summaries

---

## Current State

| Area | Status |
|------|--------|
| Pages (10 routes) | Partial — chat/settings pages missing |
| Ingest UI | URL only (dialog needs file + text) |
| Document cards | No AI summary display |
| Empty/loading/error states | Incomplete |
| Knowledge graph visualization | Data fetched, canvas not rendered |
| i18n keys | Some missing (sidebar.allBookmarks fixed) |

---

## Target State

**Platform saves everything:** URLs, PDFs, DOCX, TXT, Markdown, plain text, clipboard paste.
**On save**, the AI pipeline automatically extracts:
- **Summary** — 2–3 sentence plain-language summary
- **What it solves** — what problem/question this document addresses
- **Key points** — bullet list of core ideas
- **Category suggestions** — auto-tagged categories
- **Language** — detected locale

All of this is displayed on document cards and in detail views.

---

## Pages to Build / Fix

### 1. `/chat` — Chat & Q&A (NEW)
Full-page chat interface for querying the knowledge base.

**Components needed:**
- `app/chat/page.tsx` — route
- `components/chat/chat-page.tsx` — main layout
- `components/chat/chat-input.tsx` — multiline input, mode toggle (simple/agentic)
- `components/chat/chat-message.tsx` — user + assistant message bubbles
- `components/chat/chat-citations.tsx` — inline source citations with doc links
- `components/chat/agent-steps.tsx` — collapsible agentic decomposition steps
- `components/chat/chat-history-sidebar.tsx` — previous conversations list

**API:** `POST /api/chat` (SSE streaming, already implemented)

**Features:**
- Streaming response with SSE
- Simple mode (direct RAG answer) vs Agentic mode (decompose → multi-step reasoning)
- Citations linked to source documents
- Conversation history (stored in DB via `/api/chat`)
- New conversation button
- Copy / regenerate response

---

### 2. `/settings` — Settings (NEW)
User preferences and account management.

**Components needed:**
- `app/settings/page.tsx` — route
- `components/settings/settings-page.tsx` — tabbed layout
- `components/settings/profile-tab.tsx` — name, email, avatar upload
- `components/settings/appearance-tab.tsx` — theme (light/dark/system), language
- `components/settings/ai-tab.tsx` — default chat mode, AI model preference, API keys
- `components/settings/privacy-tab.tsx` — private mode toggle, encryption status
- `components/settings/danger-zone.tsx` — delete account, export data

**API:** PATCH `/api/user` (create if not exists), GET `/api/user/me`

---

### 3. `/` — Home Dashboard (ENHANCE)
Currently renders BookmarkCard list. Needs:
- **Multi-type document cards** — URLs show favicon + og:image, PDFs show file icon + page count, text shows character count
- **AI summary** visible on card hover/expand — summary text + key points
- **Empty state** — illustrated empty state with CTA to add first document
- **Loading skeleton** — card grid skeletons
- **Error state** — retry button with error message
- **Pagination or infinite scroll** — currently unknown

---

### 4. `/favorites`, `/archive`, `/trash` — Views (ENHANCE)
Each needs:
- Real filtered data from bookmarks-store (favorites: `is_favorite=true`, archive: `is_archived=true`, trash: `deleted_at IS NOT NULL`)
- Empty states per view ("No favorites yet", "Archive is empty", "Trash is empty")
- Trash: **Restore** and **Permanently Delete** actions
- Archive: **Unarchive** action

---

### 5. `/knowledge` — Knowledge Graph (ENHANCE)
Currently fetches nodes/edges but graph-canvas.tsx may be empty.

**Visual:** Use `react-force-graph-2d` (lightweight, no WebGL required for 2D).
- Nodes colored by type (document, entity, category)
- Edges labeled by relationship type
- Click node → NodeDetailPanel slides in
- Search/filter by node type or name
- Zoom/pan controls

---

### 6. `/categories` — Category Manager (ENHANCE)
Already implemented. Verify:
- Create / rename / delete / merge categories work end-to-end
- Drag-and-drop reordering
- Category color picker
- Document count per category
- Auto-suggestion displayed on new documents

---

## Ingest Dialog — Multi-Type

`components/dashboard/add-bookmark-dialog.tsx` must support 3 input modes:

### Tab 1: URL
```
[ https://... ] [Fetch & Save]
```
- Validate URL format
- Show loading state while fetching
- Display fetched title/preview before confirming

### Tab 2: File Upload
```
[Drop PDF, DOCX, TXT, MD here]
- or -
[Browse files]
```
- Accepted: `.pdf`, `.docx`, `.txt`, `.md`, `.html`
- Max 10MB
- Show file name + size preview
- POST to `/api/ingest/file`

### Tab 3: Text / Clipboard
```
[paste or type text here...]
[Title: ________________]
```
- Free text area
- Optional title override
- Character / word count
- POST to `/api/ingest/text`

**All tabs:** category selector + tags input (optional)

---

## AI Summary Display

Every saved document gets AI-generated metadata stored in `metadata` JSONB column.

**Card display (compact):**
```
[Title]                    [favicon/icon]
[summary — 1 sentence]
[tag1] [tag2] [category]
[source url or filename]   [date]
```

**Card expanded / detail panel:**
```
Summary
  [2–3 sentences]

What problem it solves
  [1–2 sentences]

Key points
  • ...
  • ...
  • ...

Source: [url/filename]
Saved: [date]
Language: [en/ko/...]
```

**AI extraction happens in the async job queue** (already implemented in `lib/ingest/job-queue.ts` + `apps/ai-server`). The frontend just needs to display the fields.

Fields to extract and store in `metadata`:
```json
{
  "summary": "...",
  "what_it_solves": "...",
  "key_points": ["...", "..."],
  "tags": ["...", "..."],
  "language": "en",
  "reading_time_minutes": 5
}
```

---

## Production States Required

For **every page and list component:**

| State | Implementation |
|-------|---------------|
| Loading | Skeleton cards (use `components/ui/skeleton.tsx`) |
| Empty | Illustrated empty state with action CTA |
| Error | Error message + Retry button |
| Offline | Toast banner (optional v2) |

---

## Sidebar Navigation Links

Add missing routes to sidebar nav:

```
📚 All Documents     /
⭐ Favorites         /favorites
🗄️ Archive          /archive
🗑️ Trash            /trash
---
💬 Chat              /chat
🔍 Knowledge Graph   /knowledge
🗂️ Categories        /categories
---
⚙️ Settings          /settings
```

---

## i18n Keys Missing

Add to `en.json` and `ko.json`:

```json
{
  "sidebar": {
    "allBookmarks": "All Documents",   ← already fixed
    "chat": "Chat",
    "knowledge": "Knowledge Graph",
    "categories": "Categories",
    "settings": "Settings"
  },
  "chat": {
    "newConversation": "New Chat",
    "placeholder": "Ask anything about your knowledge...",
    "simpleMode": "Simple",
    "agenticMode": "Agentic",
    "thinking": "Thinking...",
    "sources": "Sources",
    "copy": "Copy",
    "regenerate": "Regenerate"
  },
  "ingest": {
    "tabUrl": "URL",
    "tabFile": "File",
    "tabText": "Text",
    "urlPlaceholder": "https://...",
    "textPlaceholder": "Paste or type content...",
    "titlePlaceholder": "Title (optional)",
    "dropzone": "Drop files here or click to browse",
    "supportedFormats": "PDF, DOCX, TXT, MD, HTML — max 10MB",
    "saving": "Saving...",
    "saved": "Saved!"
  },
  "document": {
    "summary": "Summary",
    "whatItSolves": "What it solves",
    "keyPoints": "Key points",
    "readingTime": "{{minutes}} min read",
    "noSummary": "Processing..."
  },
  "emptyState": {
    "allDocuments": "Nothing saved yet",
    "allDocumentsCta": "Save your first document",
    "favorites": "No favorites yet",
    "archive": "Archive is empty",
    "trash": "Trash is empty",
    "search": "No results for \"{{query}}\""
  }
}
```

---

## Implementation Order

1. **i18n keys** — add all missing keys to en.json + ko.json
2. **Ingest dialog** — upgrade to 3-tab multi-type (URL / File / Text)
3. **Document card** — add AI summary fields to display
4. **Home page** — empty state, loading skeleton, pagination
5. **Favorites / Archive / Trash** — empty states + proper actions
6. **Chat page** — full new page with streaming
7. **Settings page** — full new page with tabs
8. **Knowledge graph** — wire react-force-graph-2d
9. **Sidebar** — add chat/knowledge/categories/settings links
10. **Production hardening** — error boundaries, toast notifications

---

## Key Files

| File | Change |
|------|--------|
| `components/dashboard/add-bookmark-dialog.tsx` | 3-tab ingest |
| `components/dashboard/bookmark-card.tsx` | AI summary display |
| `components/dashboard/content.tsx` | loading/empty/error states |
| `components/dashboard/favorites-content.tsx` | empty state + actions |
| `components/dashboard/archive-content.tsx` | empty state + actions |
| `components/dashboard/trash-content.tsx` | restore/purge actions |
| `components/dashboard/sidebar.tsx` | add nav links |
| `app/chat/page.tsx` | NEW |
| `app/settings/page.tsx` | NEW |
| `components/chat/*` | NEW |
| `components/settings/*` | NEW |
| `components/knowledge/graph-canvas.tsx` | wire react-force-graph-2d |
| `apps/web/messages/en.json` | i18n keys |
| `apps/web/messages/ko.json` | i18n keys |
| `apps/web/package.json` | add react-force-graph |

---

## Dependencies to Add

```bash
pnpm add react-force-graph-2d  # knowledge graph visualization
# already have: react-hot-toast or sonner for toasts? check
```

Check if toast/notification library already installed before adding.
