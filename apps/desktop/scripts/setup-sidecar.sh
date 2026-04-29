#!/bin/bash
# Download Node.js binary for Tauri sidecar bundling
# Tauri expects: binaries/<name>-<target-triple>[.exe]

set -euo pipefail

NODE_VERSION="22.15.0"
BINARIES_DIR="$(dirname "$0")/../src-tauri/binaries"
mkdir -p "$BINARIES_DIR"

# Allow override for cross-compilation (e.g., TARGET_OS=windows TARGET_ARCH=x86_64)
DETECTED_ARCH=$(uname -m)
DETECTED_OS=$(uname -s)
TARGET_OS="${TARGET_OS:-$DETECTED_OS}"
TARGET_ARCH="${TARGET_ARCH:-$DETECTED_ARCH}"

case "$TARGET_OS" in
  Darwin|darwin)
    case "$TARGET_ARCH" in
      arm64|aarch64) TARGET="aarch64-apple-darwin"; NODE_ARCH="arm64" ;;
      x86_64)        TARGET="x86_64-apple-darwin";  NODE_ARCH="x64" ;;
      *) echo "Unsupported arch: $TARGET_ARCH"; exit 1 ;;
    esac
    NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-${NODE_ARCH}.tar.gz"
    SIDECAR_PATH="$BINARIES_DIR/node-$TARGET"
    ;;
  Linux|linux)
    case "$TARGET_ARCH" in
      aarch64|arm64) TARGET="aarch64-unknown-linux-gnu"; NODE_ARCH="arm64" ;;
      x86_64)        TARGET="x86_64-unknown-linux-gnu";  NODE_ARCH="x64" ;;
      *) echo "Unsupported arch: $TARGET_ARCH"; exit 1 ;;
    esac
    NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz"
    SIDECAR_PATH="$BINARIES_DIR/node-$TARGET"
    ;;
  Windows|windows|MINGW*|MSYS*|CYGWIN*)
    case "$TARGET_ARCH" in
      x86_64|x64|AMD64) TARGET="x86_64-pc-windows-msvc"; NODE_ARCH="x64" ;;
      aarch64|arm64)     TARGET="aarch64-pc-windows-msvc"; NODE_ARCH="arm64" ;;
      *) echo "Unsupported arch: $TARGET_ARCH"; exit 1 ;;
    esac
    NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-${NODE_ARCH}.zip"
    SIDECAR_PATH="$BINARIES_DIR/node-$TARGET.exe"
    ;;
  *) echo "Unsupported OS: $TARGET_OS"; exit 1 ;;
esac

# Skip if already exists
if [ -f "$SIDECAR_PATH" ]; then
  echo "[sidecar] Node binary already exists: $SIDECAR_PATH"
  exit 0
fi

echo "[sidecar] Downloading Node.js v${NODE_VERSION} for ${TARGET}..."
TMP_DIR=$(mktemp -d)

case "$TARGET_OS" in
  Windows|windows|MINGW*|MSYS*|CYGWIN*)
    curl -fSL "$NODE_URL" -o "$TMP_DIR/node.zip"
    unzip -q "$TMP_DIR/node.zip" -d "$TMP_DIR"
    cp "$TMP_DIR"/node-v${NODE_VERSION}-win-${NODE_ARCH}/node.exe "$SIDECAR_PATH"
    ;;
  *)
    curl -fSL "$NODE_URL" | tar -xz -C "$TMP_DIR" --strip-components=1
    cp "$TMP_DIR/bin/node" "$SIDECAR_PATH"
    ;;
esac

chmod +x "$SIDECAR_PATH"
rm -rf "$TMP_DIR"

echo "[sidecar] Node binary ready: $SIDECAR_PATH"
