#!/bin/bash
# Download Node.js binary for Tauri sidecar bundling
# Tauri expects: binaries/<name>-<target-triple>

set -euo pipefail

NODE_VERSION="22.15.0"
BINARIES_DIR="$(dirname "$0")/../src-tauri/binaries"
mkdir -p "$BINARIES_DIR"

# Detect platform
ARCH=$(uname -m)
OS=$(uname -s)

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64)  TARGET="aarch64-apple-darwin"; NODE_ARCH="arm64" ;;
      x86_64) TARGET="x86_64-apple-darwin";  NODE_ARCH="x64" ;;
      *) echo "Unsupported arch: $ARCH"; exit 1 ;;
    esac
    NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-${NODE_ARCH}.tar.gz"
    ;;
  Linux)
    case "$ARCH" in
      aarch64) TARGET="aarch64-unknown-linux-gnu"; NODE_ARCH="arm64" ;;
      x86_64)  TARGET="x86_64-unknown-linux-gnu";  NODE_ARCH="x64" ;;
      *) echo "Unsupported arch: $ARCH"; exit 1 ;;
    esac
    NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz"
    ;;
  *) echo "Unsupported OS: $OS"; exit 1 ;;
esac

SIDECAR_PATH="$BINARIES_DIR/node-$TARGET"

# Skip if already exists
if [ -f "$SIDECAR_PATH" ]; then
  echo "[sidecar] Node binary already exists: $SIDECAR_PATH"
  exit 0
fi

echo "[sidecar] Downloading Node.js v${NODE_VERSION} for ${TARGET}..."
TMP_DIR=$(mktemp -d)
curl -fSL "$NODE_URL" | tar -xz -C "$TMP_DIR" --strip-components=1

cp "$TMP_DIR/bin/node" "$SIDECAR_PATH"
chmod +x "$SIDECAR_PATH"
rm -rf "$TMP_DIR"

echo "[sidecar] Node binary ready: $SIDECAR_PATH"
