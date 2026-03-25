#!/usr/bin/env bash
# ============================================
# SayKnowMind — Telegram Polling Bridge
# ============================================
# OpenClaw-style: outbound-only, no webhook needed.
# Polls Telegram getUpdates → forwards to localhost webhook handler.
#
# Usage: ./scripts/telegram-poll.sh
#        TELEGRAM_BOT_TOKEN=xxx ./scripts/telegram-poll.sh
# ============================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Load .env
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

TOKEN="${TELEGRAM_BOT_TOKEN:-}"
WEBHOOK_URL="${TELEGRAM_POLL_TARGET:-http://localhost:3000/api/integrations/telegram/webhook}"
SECRET="${TELEGRAM_WEBHOOK_SECRET:-}"
POLL_TIMEOUT=30

if [ -z "$TOKEN" ]; then
  echo "[telegram-poll] TELEGRAM_BOT_TOKEN not set. Add it to .env or export it."
  exit 1
fi

# Verify bot token
ME=$(curl -s "https://api.telegram.org/bot${TOKEN}/getMe")
BOT_OK=$(echo "$ME" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ok', False))" 2>/dev/null || echo "False")
if [ "$BOT_OK" != "True" ]; then
  echo "[telegram-poll] Invalid bot token. Check TELEGRAM_BOT_TOKEN."
  exit 1
fi
BOT_NAME=$(echo "$ME" | python3 -c "import sys,json; r=json.load(sys.stdin).get('result',{}); print(f\"@{r.get('username', r.get('id', '?'))}\")" 2>/dev/null)
echo "[telegram-poll] Bot: $BOT_NAME"
echo "[telegram-poll] Target: $WEBHOOK_URL"
echo "[telegram-poll] Polling started (Ctrl+C to stop)"

# Delete any existing webhook so getUpdates works
curl -s "https://api.telegram.org/bot${TOKEN}/deleteWebhook" > /dev/null

OFFSET=0

while true; do
  # getUpdates — long poll (outbound, works on localhost)
  RESPONSE=$(curl -s --max-time $((POLL_TIMEOUT + 5)) \
    "https://api.telegram.org/bot${TOKEN}/getUpdates" \
    -d "offset=${OFFSET}&timeout=${POLL_TIMEOUT}&allowed_updates=[\"message\",\"callback_query\"]" \
    2>/dev/null || echo '{"ok":false}')

  OK=$(echo "$RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ok', False))" 2>/dev/null || echo "False")
  if [ "$OK" != "True" ]; then
    sleep 2
    continue
  fi

  # Parse updates array
  UPDATES=$(echo "$RESPONSE" | python3 -c "
import sys, json
data = json.load(sys.stdin)
updates = data.get('result', [])
for u in updates:
    print(json.dumps(u))
" 2>/dev/null)

  if [ -z "$UPDATES" ]; then
    continue
  fi

  # Forward each update to localhost webhook handler
  while IFS= read -r update; do
    [ -z "$update" ] && continue

    # Extract update_id for offset
    UID=$(echo "$update" | python3 -c "import sys,json; print(json.load(sys.stdin).get('update_id', 0))" 2>/dev/null || echo "0")
    NEW_OFFSET=$((UID + 1))
    if [ "$NEW_OFFSET" -gt "$OFFSET" ]; then
      OFFSET=$NEW_OFFSET
    fi

    # Forward to webhook handler (local → local)
    HEADERS=(-H "Content-Type: application/json")
    if [ -n "$SECRET" ]; then
      HEADERS+=(-H "x-telegram-bot-api-secret-token: $SECRET")
    fi

    STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
      "${HEADERS[@]}" \
      -d "$update" \
      "$WEBHOOK_URL" 2>/dev/null || echo "000")

    # Log
    FROM=$(echo "$update" | python3 -c "
import sys,json
u=json.load(sys.stdin)
m=u.get('message',u.get('callback_query',{}))
f=m.get('from',{})
print(f.get('username', f.get('first_name', '?')))
" 2>/dev/null || echo "?")
    TEXT=$(echo "$update" | python3 -c "
import sys,json
u=json.load(sys.stdin)
m=u.get('message',{})
t=m.get('text',m.get('caption',''))[:50]
print(t)
" 2>/dev/null || echo "")

    echo "[telegram-poll] ${FROM}: \"${TEXT}\" → ${STATUS}"
  done <<< "$UPDATES"
done
