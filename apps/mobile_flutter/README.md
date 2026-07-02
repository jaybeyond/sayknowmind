# SayKnowMind — Flutter mobile app

A **real native** iOS + Android client for SayKnowMind (not a webview wrapper of
`apps/web`). It talks to the same backend REST API the web app uses, with the
design system ported from the web's shadcn/ui tokens.

## Status — v1 (Core + AI Chat)

- **Auth** — email/password sign-in & sign-up via better-auth, token-based
  (`Authorization: Bearer`). Configurable backend URL (defaults to the Open
  edition `https://mind.sayknow.ai`; localhost picker for dev).
- **Memories feed** — paginated, search filter, starred filter, pull-to-refresh,
  infinite scroll, favorite/archive/trash, processing badges.
- **Detail** — image, AI summary, "what it solves", key points, tags, markdown
  body, open source link, favorite/archive/delete.
- **Capture** — quick-add a link or a note, optional collection, dedupe handling.
- **Search** — semantic search (`POST /api/search`) → tap into a memory.
- **Chat** — streaming RAG chat (SSE), conversation list, citations, history.
- **Collections** — list/create collections, browse a collection's memories.
- **Settings** — profile, light/dark/system theme, backend URL, sign out.

## Backend dependency

This app requires the **better-auth `bearer` plugin** on the backend (added in
`apps/web/lib/auth.ts`: `plugins: [organization(), bearer(), nextCookies()]`)
and the `sayknowmind://` trusted origin. Sign-in/up responses then return the
session token via the `set-auth-token` header, which the app stores in the OS
keychain/keystore and replays as `Authorization: Bearer <token>`.

## Architecture

```
lib/
  core/        theme (design tokens), config, storage (secure token + prefs), api_client (dio + bearer)
  models/      memory, category, chat, app_user, search_result
  data/        repositories (auth, document, ingest, search, category, chat)
  providers.dart   riverpod providers + auth/feed/theme controllers (Notifier)
  routing/     go_router with auth redirect
  features/    auth, splash, shell (bottom nav), feed, detail, capture, search, chat, collections, settings
  widgets/     memory_card, app_image (bearer-authed), brand, states, backend_url_dialog
```

State: **Riverpod 3** (`Notifier`/`NotifierProvider`). Routing: **go_router**.
HTTP: **dio** (custom App User-Agent — the ingest routes 403 bot-like UAs).
Images go through the app's own `/api/og/{id}` / `/api/files/{id}` proxy with
the bearer header (never a raw external CDN URL).

## Run

```bash
cd apps/mobile_flutter
flutter pub get
flutter run            # pick a device/simulator
```

Point the app at a backend from the **Settings → Backend server** tile (or the
server chip on the login screen).

## Not in v1 (fast-follows)

- **OS share-sheet ingest** (share a link from Safari/Chrome into the app). The
  router already accepts `/capture?text=…`; wiring the iOS Share Extension +
  Android `SEND` intent (e.g. `receive_sharing_intent`) is the remaining native
  step.
- File upload capture (`POST /api/ingest/file`, multipart) — repo method TODO.
- Knowledge graph, published/sharing management, team org switcher.
- Enterprise (SaaS) login via `POST /api/auth/external-login`.
- Push notifications / background ingest-status via SSE `/api/events/stream`.
