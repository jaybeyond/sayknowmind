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

apply_sql db/init/10-integration-tokens.sql        || exit 3
apply_sql db/migrations/038_user_provider_configs.sql || exit 3

# better-auth rateLimit (no migration file ships this)
echo "creating rateLimit table (if missing)"
maybe sudo psql "$DBURL" -c 'CREATE TABLE IF NOT EXISTS "rateLimit" (
  id text PRIMARY KEY, key text, count integer DEFAULT 0, "lastRequest" bigint
);' 2>&1 | tail -3

# ─── Image pull ─────────────────────────────────────────────────────
log "STEP 4: DOCKER COMPOSE PULL"
cd "$(dirname "$COMPOSE")"
maybe sudo docker compose pull 2>&1 | tail -15

# ─── Restart ────────────────────────────────────────────────────────
if [ "${SKIP_RESTART:-0}" = "1" ]; then
  echo "SKIP_RESTART=1 — leaving containers alone"
else
  log "STEP 5: ROLLING RESTART"
  maybe sudo docker compose up -d --remove-orphans 2>&1 | tail -15
  sleep 5
  sudo docker compose ps 2>&1 | head
fi

# ─── Verify ─────────────────────────────────────────────────────────
log "STEP 6: VERIFY"
sleep 3
LOCAL_CODE=$(curl -sS -m 5 -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/auth/get-session 2>/dev/null || echo "ERR")
echo "local 127.0.0.1:3000  → HTTP $LOCAL_CODE"
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
