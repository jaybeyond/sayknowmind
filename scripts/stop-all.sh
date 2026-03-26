#!/usr/bin/env bash
# ============================================
# SayKnowMind — Stop All Services
# ============================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PID_DIR="$ROOT_DIR/.pids"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

if [ ! -d "$PID_DIR" ]; then
  echo "No PID directory found — nothing to stop."
  exit 0
fi

echo ""
echo "Stopping SayKnowMind services..."
echo ""

for pidfile in "$PID_DIR"/*.pid; do
  [ -f "$pidfile" ] || continue
  name="$(basename "$pidfile" .pid)"
  pid="$(cat "$pidfile")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    echo -e "  ${GREEN}[✓]${NC} Stopped $name (PID $pid)"
  else
    echo -e "  ${RED}[✗]${NC} $name (PID $pid) already stopped"
  fi
  rm -f "$pidfile"
done

echo ""
echo "All services stopped."
echo ""
