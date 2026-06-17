#!/usr/bin/env bash
#
# production-deploy.sh
# --------------------
# One-shot deploy script for the production EC2 host. Idempotent —
# safe to run repeatedly. Designed to be run from the project root
# on the production server, typically via:
#
#     cd /opt/sayknowmind        # or wherever the repo lives
#     git pull
#     sudo ./scripts/production-deploy.sh
#
# What it does:
#   1. State — print user/host, docker ps, discover repo/compose/.env
#   2. Code  — git fetch + git pull (gitlab → origin fallback)
#   3. DB    — pg_dump backup → apply idempotent migrations (NEW
#              tables only: user_integration_tokens, user_integration_imports,
#              user_provider_configs, rateLimit). Existing data untouched.
#   4. Image — docker compose pull (just fetches new image, no restart)
#   5. Roll  — docker compose up -d --remove-orphans (5–10s downtime)
#   6. Check — local + external curl verifies the new instance is up
#
# Env / arg controls (optional):
#   DRY_RUN=1        — print the destructive commands, don't run them
#   SKIP_BACKUP=1    — skip pg_dump (faster on big DBs; use only if you
#                      have a recent backup already)
#   SKIP_RESTART=1   — pull image + migrations only, leave container alone
#   BACKUP_DIR=/path — where to write the dump (default /tmp)
#
# Exit codes:
#   0 success
#   1 prerequisite missing (no git repo, no compose file, etc.)
#   2 git pull failed
#   3 migration failed
#   4 docker compose failed
#   5 verification failed

set -uo pipefail

# ─── Discovery ──────────────────────────────────────────────────────
log() { printf '\n=========== %s ===========\n' "$*"; }
maybe() { if [ "${DRY_RUN:-0}" = "1" ]; then echo "  (dry-run) $*"; else "$@"; fi; }

DATE="$(date +%Y%m%d-%H%M%S)"
BACKUP_DIR="${BACKUP_DIR:-/tmp}"

log "STEP 1: STATE"
echo "user=$(whoami) host=$(hostname) pwd=$(pwd) date=$DATE"
echo
echo "--docker ps--"
sudo docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' 2>&1 | head -20
echo
echo "--discovery--"
SAYKNOW_DIRS=$(sudo find /opt /home -maxdepth 4 -type d -iname "sayknow*" 2>/dev/null)
COMPOSE_FILES=$(sudo find /opt /home -maxdepth 4 -name "docker-compose*.yml" 2>/dev/null)
ENV_FILES=$(sudo find /opt /home -maxdepth 4 -name ".env" -not -path "*/node_modules/*" 2>/dev/null)
GIT_DIRS=$(sudo find /opt /home -maxdepth 4 -name ".git" -type d 2>/dev/null)

echo "sayknow dirs:"; printf '  %s\n' $SAYKNOW_DIRS
echo "compose files:"; printf '  %s\n' $COMPOSE_FILES
echo "env files:";     printf '  %s\n' $ENV_FILES
echo "git dirs:";      printf '  %s\n' $GIT_DIRS

# Pick the first match for each (most setups have one).
REPO="$(echo "$GIT_DIRS"      | head -1 | xargs -I{} dirname {})"
COMPOSE="$(echo "$COMPOSE_FILES" | head -1)"
ENV_FILE="$(echo "$ENV_FILES"  | head -1)"

echo
echo "REPO=$REPO"
echo "COMPOSE=$COMPOSE"
echo "ENV_FILE=$ENV_FILE"

if [ -z "$REPO" ] || [ -z "$COMPOSE" ] || [ -z "$ENV_FILE" ]; then
  echo "ERROR: missing one of repo/compose/env_file — bailing"
  exit 1
fi

# ─── Code update ────────────────────────────────────────────────────
log "STEP 2: GIT PULL"
cd "$REPO"
sudo git remote -v
sudo git fetch --all 2>&1 | tail -5
HEAD_BEFORE=$(sudo git rev-parse --short HEAD)
echo "before: $HEAD_BEFORE"
if ! maybe sudo git pull --ff-only gitlab main 2>&1; then
  echo "gitlab pull failed, trying origin"
  if ! maybe sudo git pull --ff-only origin main 2>&1; then
    echo "ERROR: git pull failed"
    exit 2
  fi
fi
HEAD_AFTER=$(sudo git rev-parse --short HEAD)
echo "after:  $HEAD_AFTER"
sudo git log --oneline -5

# ─── DB ─────────────────────────────────────────────────────────────
log "STEP 3: DB BACKUP + MIGRATIONS"
DBURL=$(sudo grep -E "^DATABASE_URL=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
if [ -z "$DBURL" ]; then
  echo "ERROR: DATABASE_URL not found in $ENV_FILE"
  exit 3
fi
echo "DBURL prefix: ${DBURL:0:40}..."

if [ "${SKIP_BACKUP:-0}" != "1" ]; then
  BACKUP_FILE="$BACKUP_DIR/sayknowmind-backup-$DATE.sql"
  echo "backup → $BACKUP_FILE"
  if maybe sudo pg_dump "$DBURL" > "$BACKUP_FILE" 2>/dev/null; then
    if [ "${DRY_RUN:-0}" != "1" ]; then
      ls -lh "$BACKUP_FILE"
    fi
  else
    echo "WARN: pg_dump failed (continuing — schema migrations are idempotent)"
  fi
else
  echo "SKIP_BACKUP=1 — skipping pg_dump"
fi

apply_sql() {
  local f="$REPO/$1"
  if [ ! -f "$f" ]; then
    echo "skip (missing): $1"
    return
  fi
  echo "applying $1"
  if ! maybe sudo psql "$DBURL" -f "$f" 2>&1 | tail -5; then
    echo "ERROR: $1 failed"
    return 1
  fi
}

apply_sql db/init/10-integration-tokens.sql           || exit 3
apply_sql db/migrations/038_user_provider_configs.sql || exit 3
# 031 replaces the legacy EdgeQuake multi-tenant conversations/messages
# tables (conversation_id PK + tenant_id) with the simple better-auth
# schema (id PK + user_id TEXT) the web app actually queries against.
# DROPs are guarded by IF EXISTS — but the migration *will* delete any
# rows in those tables, so it's safe only when they hold no data we
# care about (currently always true: chat was broken before this).
apply_sql db/migrations/031_conversations_simple.sql  || exit 3
apply_sql db/migrations/032_document_relations.sql    || exit 3
# 028/029/030/037 build the channel_links table used by every
# messaging integration (Telegram, Slack, Discord). Without these
# verifyAndSave from the integrations tab dies with
# `relation "channel_links" does not exist` and the UI shows
# "Not configured" forever even after a successful token verify.
# 028 has a soft data-migration step from a legacy telegram_links
# table that's safely skipped on fresh deploys (CREATE TABLE runs
# anyway because it precedes the FROM telegram_links query).
apply_sql db/migrations/028_channel_links.sql                 || true
apply_sql db/migrations/029_add_bot_token_to_channel_links.sql || exit 3
apply_sql db/migrations/030_add_lang_to_channel_links.sql      || exit 3
apply_sql db/migrations/037_channel_links_unique_channel_user.sql || exit 3
# 041 sets up the user_mcp_keys table so per-user MCP API keys can
# be issued via /api/user/mcp-key and validated by the mcp-server
# container's authMiddleware. The route also calls ensureTable() on
# first use, but applying the migration here keeps schema_migrations
# honest for fresh deploys.
apply_sql db/migrations/041_user_mcp_keys.sql         || exit 3
# 042 adds the dedicated tags + document_tags tables. Without them
# every job-queue summarization run dies with
# `relation "tags" does not exist` the moment listTagNames() runs.
apply_sql db/migrations/042_tags_table.sql            || exit 3
# 045 strips the bogus trailing /v1 from existing OCP rows so the
# cloud-ai cascade composes /v1/chat/completions cleanly instead of
# /v1/v1/chat/completions. Idempotent — UPDATE only matches rows
# that still have the suffix.
apply_sql db/migrations/045_fix_ocp_base_url.sql      || exit 3
# 046 corrects OCP/Codex `model` values so the LLM relay can dispatch:
# OCP's CLI rejects the bare "claude-opus" alias, and Codex's exec
# fails on "--model codex-default". Both are remapped to working
# values. Idempotent.
apply_sql db/migrations/046_fix_provider_models.sql   || exit 3
# 047 records Telegram update receipts so webhook retries do not send the
# same AI failure/unavailable message repeatedly when a user's local relay is
# offline.
apply_sql db/migrations/047_telegram_processed_updates.sql || exit 3
# 048 resets Codex rows that selected API-only model IDs (for example
# "gpt-5") which ChatGPT-account Codex rejects at runtime.
apply_sql db/migrations/048_fix_codex_chatgpt_models.sql || exit 3
# 049 adds compatibility columns expected by web ingestion/knowledge graph
# routes when production's entities table was created by EdgeQuake first.
apply_sql db/migrations/049_web_graph_schema_compat.sql || exit 3
# 050 scopes Telegram sender links by bot token and excludes pending
# verification-code rows from uniqueness, so user-owned bots remain isolated.
apply_sql db/migrations/050_telegram_per_bot_link_scope.sql || exit 3
# 051 adds mcp_audit_log, read by /api/user/mcp-audit and written by the
# mcp-server per per-user-key call. Missing → the audit view 500s.
apply_sql db/migrations/051_mcp_audit_log.sql || exit 3
# 052 adds the UNIQUE (user_id, name, COALESCE(parent_id)) index that the
# ingest job-queue and MCP category_create rely on for ON CONFLICT. Missing
# → AI-suggested collections silently never land (empty Collections panel).
apply_sql db/migrations/052_categories_unique_per_user_parent.sql || exit 3
# 053–058 are the team feature: better-auth organization plugin tables, then
# organization_id on the six user-scoped resource tables, team-visible default,
# and the per-resource / per-team share ACLs. The web app's visibility layer
# (lib/org-context.ts, lib/visibility.ts) queries these — without them every
# org-scoped read and all sharing break. Additive (CREATE TABLE / ADD COLUMN
# IF NOT EXISTS) and order-sensitive: 053 must precede 054–058.
apply_sql db/migrations/053_add_organization_tables.sql || exit 3
apply_sql db/migrations/054_add_organization_id_to_resources.sql || exit 3
apply_sql db/migrations/055_team_visibility_defaults.sql || exit 3
apply_sql db/migrations/056_add_resource_shares.sql || exit 3
apply_sql db/migrations/057_backfill_orphan_organization_id.sql || exit 3
apply_sql db/migrations/058_add_resource_team_shares.sql || exit 3
# 059 doc_collab persists the Yjs CRDT state for live collaborative editing
# (relay-server onLoadDocument/onStoreDocument). 060 adds categories.kind so
# the Collections / Documents / Mind maps folder trees don't collide. 061
# document_versions backs version-history capture+restore at PATCH
# /api/documents/:id. All additive and required by the collab/version features
# on this branch — missing → "relation does not exist" at runtime.
apply_sql db/migrations/059_add_doc_collab.sql || exit 3
apply_sql db/migrations/060_add_category_kind.sql || exit 3
apply_sql db/migrations/061_add_document_versions.sql || exit 3
# 062 stops storing MCP API keys in plaintext: adds api_key_hash (validation)
# + api_key_enc (re-display), backfills hashes for existing keys, drops the
# NOT NULL on api_key. Requires pgcrypto (created by the migration). Existing
# keys keep working — they validate by the backfilled hash.
apply_sql db/migrations/062_hash_mcp_api_keys.sql || exit 3
# 063 fixes the global entities-name collision: the web-app-owned entities table
# deduped by name across ALL users (tenant_id/workspace_id always NULL), merging
# different users' entities into one row. Scopes dedup per organization_id instead
# (additive column + per-org partial unique index; drops the global constraint that
# only the web app used).
apply_sql db/migrations/063_entities_per_org_unique.sql || exit 3

# better-auth rateLimit (no migration file ships this)
echo "creating rateLimit table (if missing)"
maybe sudo psql "$DBURL" -c 'CREATE TABLE IF NOT EXISTS "rateLimit" (
  id text PRIMARY KEY, key text, count integer DEFAULT 0, "lastRequest" bigint
);' 2>&1 | tail -3

# ─── Image pull ─────────────────────────────────────────────────────
log "STEP 4: DOCKER COMPOSE PULL"
cd "$(dirname "$COMPOSE")"
# Best-effort pull — services declared with `image:` (e.g. redis) get
# refreshed here. Services with `build:` ignore pull, so the heavy
# lifting happens in `up -d --build` below.
maybe sudo docker compose pull 2>&1 | tail -15 || true

# ─── Restart ────────────────────────────────────────────────────────
if [ "${SKIP_RESTART:-0}" = "1" ]; then
  echo "SKIP_RESTART=1 — leaving containers alone"
else
  log "STEP 5: ROLLING RESTART"
  # --build forces a rebuild of any service with a `build:` directive
  # (web, ai-server, edgequake, ocr, dashboard) so the new git commit
  # we just pulled actually lands in the running container. Without
  # this flag `up -d` would reuse the cached image from the last
  # build and silently ship stale code.
  maybe sudo docker compose up -d --build --remove-orphans 2>&1 | tail -30
  sleep 5
  sudo docker compose ps 2>&1 | head
fi

# ─── Verify ─────────────────────────────────────────────────────────
log "STEP 6: VERIFY"
sleep 3
LOCAL_CODE=$(curl -sS -m 5 -o /dev/null -w "%{http_code}" http://127.0.0.1:5400/api/auth/get-session 2>/dev/null || echo "ERR")
echo "local 127.0.0.1:5400  → HTTP $LOCAL_CODE"
EXT_CODE=$(curl -sS -m 10 -o /dev/null -w "%{http_code}" https://sayknowmind.ypai.click/api/auth/get-session 2>/dev/null || echo "ERR")
echo "external (ypai.click) → HTTP $EXT_CODE"

if [ "$LOCAL_CODE" = "200" ]; then
  echo "✅ Local instance healthy."
else
  echo "⚠️  Local HTTP not 200 — check 'docker compose logs web' for the cause."
fi
if [ "$EXT_CODE" = "200" ]; then
  echo "✅ External endpoint reachable."
else
  echo "⚠️  External not 200 — could be DNS/CDN cache or nginx proxy config."
fi

log "DONE"
echo "Pulled $HEAD_BEFORE → $HEAD_AFTER"
echo "Backup: ${BACKUP_FILE:-(skipped)}"
echo "Rollback: 'cd $(dirname "$COMPOSE") && sudo docker compose down && sudo git -C $REPO reset --hard $HEAD_BEFORE && sudo docker compose up -d'"
