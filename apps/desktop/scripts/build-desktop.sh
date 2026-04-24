#!/bin/bash
# Build web app for desktop bundling + setup Node sidecar
# Called by Tauri's beforeBuildCommand

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_DIR="$(cd "$DESKTOP_DIR/../web" && pwd)"
RESOURCES_DIR="$DESKTOP_DIR/src-tauri/resources"

echo "=== [desktop-build] Step 1: Setup Node sidecar ==="
bash "$SCRIPT_DIR/setup-sidecar.sh"

echo "=== [desktop-build] Step 2: Build web app (standalone) ==="
cd "$WEB_DIR"
rm -rf .next
NEXT_PUBLIC_DEPLOY_MODE=desktop \
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3457 \
pnpm build

echo "=== [desktop-build] Step 3: Copy standalone to resources ==="
rm -rf "$RESOURCES_DIR/web-standalone"
mkdir -p "$RESOURCES_DIR/web-standalone"

# Next.js standalone mirrors the full filesystem path — find the actual server root
STANDALONE_ROOT=$(find "$WEB_DIR/.next/standalone" -name "server.js" -not -path "*/node_modules/*" -exec dirname {} \; | head -1)
if [ -z "$STANDALONE_ROOT" ]; then
  echo "[desktop-build] ERROR: server.js not found in standalone output"
  exit 1
fi
echo "[desktop-build] Found standalone root: $STANDALONE_ROOT"

# Copy preserving symlinks first
cp -R "$STANDALONE_ROOT/." "$RESOURCES_DIR/web-standalone/"

# Resolve all symlinks in-place (Tauri can't bundle symlinks)
cd "$RESOURCES_DIR/web-standalone"
find . -type l | while read -r link; do
  target=$(readlink -f "$link" 2>/dev/null || true)
  if [ -n "$target" ] && [ -e "$target" ]; then
    rm "$link"
    cp -R "$target" "$link"
  else
    rm "$link"
  fi
done

echo "=== [desktop-build] Step 4: Flatten pnpm hoisted packages ==="
# pnpm keeps hoisted deps in .pnpm/node_modules/ — copy to top-level for Node resolution
PNPM_HOISTED="$RESOURCES_DIR/web-standalone/node_modules/.pnpm/node_modules"
if [ -d "$PNPM_HOISTED" ]; then
  for pkg in "$PNPM_HOISTED"/*/; do
    name=$(basename "$pkg")
    dest="$RESOURCES_DIR/web-standalone/node_modules/$name"
    [ -e "$dest" ] || cp -R "$pkg" "$dest"
  done
  # Scoped packages (@xxx/yyy)
  for scope in "$PNPM_HOISTED"/@*/; do
    [ -d "$scope" ] || continue
    scope_name=$(basename "$scope")
    mkdir -p "$RESOURCES_DIR/web-standalone/node_modules/$scope_name"
    for pkg in "$scope"/*/; do
      name=$(basename "$pkg")
      dest="$RESOURCES_DIR/web-standalone/node_modules/$scope_name/$name"
      [ -e "$dest" ] || cp -R "$pkg" "$dest"
    done
  done
  echo "[desktop-build] Hoisted packages flattened"
fi
cd -

# Static assets needed by standalone server
if [ -d "$WEB_DIR/.next/static" ]; then
  mkdir -p "$RESOURCES_DIR/web-standalone/.next/static"
  cp -R "$WEB_DIR/.next/static/." "$RESOURCES_DIR/web-standalone/.next/static/"
fi

# Public files
if [ -d "$WEB_DIR/public" ]; then
  mkdir -p "$RESOURCES_DIR/web-standalone/public"
  cp -R "$WEB_DIR/public/." "$RESOURCES_DIR/web-standalone/public/"
fi

echo "=== [desktop-build] Step 5: Link Turbopack hashed externals ==="
# Turbopack generates hashed names for serverExternalPackages (e.g. pg-53265b4d7b96f656)
# Create aliases so Node.js can resolve them
cd "$RESOURCES_DIR/web-standalone"
npm install --no-save --no-package-lock pg 2>/dev/null

# Find hashed external names and create package aliases
for hashed in $(grep -roh '[a-z]*-[a-f0-9]\{16\}' .next/server/chunks/\[root-of-the-server\]*.js 2>/dev/null | sort -u); do
  pkg=$(echo "$hashed" | sed 's/-[a-f0-9]\{16\}$//')
  if [ -d "node_modules/$pkg" ] && [ ! -d "node_modules/$hashed" ]; then
    cp -R "node_modules/$pkg" "node_modules/$hashed"
    echo "[desktop-build] Aliased $hashed -> $pkg"
  fi
done
cd -

echo "=== [desktop-build] Done. Resources at: $RESOURCES_DIR/web-standalone ==="
