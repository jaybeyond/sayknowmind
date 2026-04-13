#!/bin/bash
# SayknowMind Desktop — Start embedded Next.js server with PGlite
# This script is bundled as a Tauri sidecar

DIR="$(cd "$(dirname "$0")" && pwd)"
export NODE_ENV=production
export PGLITE_MODE=true
export PORT=${SAYKNOWMIND_PORT:-3457}
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-$(openssl rand -base64 32)}"
export BETTER_AUTH_URL="http://localhost:${PORT}"
export NEXT_PUBLIC_APP_URL="http://localhost:${PORT}"

# Persist the generated secret so sessions survive restarts
SECRET_FILE="$HOME/Library/Application Support/com.sayknowmind.desktop/auth-secret"
if [ -f "$SECRET_FILE" ]; then
  export BETTER_AUTH_SECRET="$(cat "$SECRET_FILE")"
else
  mkdir -p "$(dirname "$SECRET_FILE")"
  echo "$BETTER_AUTH_SECRET" > "$SECRET_FILE"
  chmod 600 "$SECRET_FILE"
fi

echo "[desktop] Starting SayknowMind on port $PORT (PGlite mode)"

# Run the standalone Next.js server
# Search order: bundled Resources > sibling folder > app data cache
WEB_DIR=""
for candidate in \
  "$DIR/../Resources/web-standalone" \
  "$DIR/../web-standalone" \
  "$HOME/Library/Application Support/com.sayknowmind.desktop/web-standalone"; do
  if [ -f "$candidate/server.js" ]; then
    WEB_DIR="$candidate"
    break
  fi
done

if [ -z "$WEB_DIR" ]; then
  echo "[desktop] ERROR: web-standalone not found. Please run the installer."
  exit 1
fi

echo "[desktop] Using server at: $WEB_DIR"
cd "$WEB_DIR" && exec node server.js
