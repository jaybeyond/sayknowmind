#!/usr/bin/env bash
# ============================================
# SayKnowMind — Start All Services (Native)
# ============================================
# Usage: ./scripts/start-all.sh
#        make dev-all
#
# Starts all services as background processes.
# Requires: PostgreSQL, Ollama already running.
# ============================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
PID_DIR="$ROOT_DIR/.pids"

mkdir -p "$LOG_DIR" "$PID_DIR"

# Load .env if present
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  source "$ROOT_DIR/.env"
  set +a
fi

export DATABASE_URL="${DATABASE_URL:-postgresql://postgres@localhost:5433/sayknowmind}"
export RUST_LOG="${RUST_LOG:-info}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
fail()  { echo -e "${RED}[✗]${NC} $1"; }

check_port() {
  lsof -i :"$1" -sTCP:LISTEN >/dev/null 2>&1
}

start_service() {
  local name="$1" port="$2" cmd="$3" dir="${4:-$ROOT_DIR}"
  local pidfile="$PID_DIR/$name.pid"
  local logfile="$LOG_DIR/$name.log"

  if check_port "$port"; then
    info "$name already running on port $port"
    return 0
  fi

  echo -e "    Starting $name on port $port..."
  cd "$dir"
  nohup bash -c "$cmd" > "$logfile" 2>&1 &
  local pid=$!
  echo "$pid" > "$pidfile"
  cd "$ROOT_DIR"

  # Wait up to 10s for port
  for i in $(seq 1 20); do
    if check_port "$port"; then
      info "$name started (PID $pid, port $port)"
      return 0
    fi
    sleep 0.5
  done

  warn "$name may still be starting (PID $pid) — check $logfile"
}


echo ""
echo "============================================"
echo " SayKnowMind — Starting All Services"
echo "============================================"
echo ""

# ── Prerequisites ──
echo "Checking prerequisites..."

if ! check_port 5432 && ! check_port 5433; then
  fail "PostgreSQL not running (checked ports 5432, 5433)"
  exit 1
fi
info "PostgreSQL detected"

if check_port 11434; then
  info "Ollama detected"
else
  warn "Ollama not running on 11434 — LLM features will use mock provider"
fi

echo ""

# ── EdgeQuake (8080) ──
start_service "edgequake" 8080 \
  "DATABASE_URL=$DATABASE_URL RUST_LOG=$RUST_LOG ./target/release/edgequake" \
  "$ROOT_DIR/packages/edgequake"

# ── MCP Server (8082) ──
start_service "mcp-server" 8082 \
  "EDGEQUAKE_URL=http://localhost:8080 PORT=8082 node ./dist/index.js" \
  "$ROOT_DIR/packages/mcp-server"

# ── AI Server (4000) ──
start_service "ai-server" 4000 \
  "npm run start:dev" \
  "$ROOT_DIR/apps/ai-server"

# ── IPFS Kubo (5001) ──
if command -v ipfs >/dev/null 2>&1; then
  start_service "ipfs" 5001 "ipfs daemon"
else
  warn "IPFS (Kubo) not installed — shared mode will be unavailable"
fi

# ── Web App (3000) ──
start_service "web" 3000 \
  "pnpm dev" \
  "$ROOT_DIR/apps/web"

# ── Telegram Polling Bridge (no port — outbound only) ──
if [ -n "${TELEGRAM_BOT_TOKEN:-}" ]; then
  pidfile="$PID_DIR/telegram-poll.pid"
  if [ -f "$pidfile" ] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    info "telegram-poll already running"
  else
    echo -e "    Starting telegram-poll (outbound bridge)..."
    nohup bash "$ROOT_DIR/scripts/telegram-poll.sh" > "$LOG_DIR/telegram-poll.log" 2>&1 &
    echo "$!" > "$pidfile"
    info "telegram-poll started (PID $!)"
  fi
else
  warn "TELEGRAM_BOT_TOKEN not set — Telegram bridge skipped"
fi

echo ""
echo "============================================"
echo " Service Status"
echo "============================================"
echo ""

for svc in "Web:3000" "AI-Server:4000" "EdgeQuake:8080" "MCP-Server:8082" "IPFS:5001" "Ollama:11434"; do
  name="${svc%%:*}"
  port="${svc#*:}"
  if check_port "$port"; then
    printf "  ✅ %-14s port %s\n" "$name" "$port"
  else
    printf "  ❌ %-14s port %s\n" "$name" "$port"
  fi
done

echo ""
info "All services started. Logs in: $LOG_DIR/"
echo "    Stop all: make dev-stop"
echo ""
