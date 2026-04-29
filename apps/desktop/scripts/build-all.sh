#!/bin/bash
# Build SayknowMind Desktop for multiple platforms × modes
# Usage:
#   ./build-all.sh                    # Build all (current platform)
#   ./build-all.sh full               # Full only (current platform)
#   ./build-all.sh lite               # Lite only (current platform)
#   ./build-all.sh full mac           # Full for Mac
#   ./build-all.sh full windows       # Full for Windows (cross-compile)
#
# Cross-compilation to Windows requires:
#   rustup target add x86_64-pc-windows-msvc
#   (or use GitHub Actions for CI builds)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

MODE="${1:-all}"     # full | lite | all
PLATFORM="${2:-}"    # mac | windows | empty = current

cd "$DESKTOP_DIR"

build_full() {
  local target_flag="${1:-}"
  echo ""
  echo "╔══════════════════════════════════════════════╗"
  echo "║  Building SayknowMind FULL $target_flag"
  echo "╚══════════════════════════════════════════════╝"
  echo ""

  if [ -n "$target_flag" ]; then
    cargo tauri build --features full --no-default-features --config src-tauri/tauri.full.conf.json --target "$target_flag"
  else
    cargo tauri build --features full --no-default-features --config src-tauri/tauri.full.conf.json
  fi
}

build_lite() {
  local target_flag="${1:-}"
  echo ""
  echo "╔══════════════════════════════════════════════╗"
  echo "║  Building SayknowMind LITE $target_flag"
  echo "╚══════════════════════════════════════════════╝"
  echo ""

  if [ -n "$target_flag" ]; then
    cargo tauri build --features lite --no-default-features --config src-tauri/tauri.lite.conf.json --target "$target_flag"
  else
    cargo tauri build --features lite --no-default-features --config src-tauri/tauri.lite.conf.json
  fi
}

resolve_target() {
  local plat="$1"
  case "$plat" in
    mac|macos)
      # Detect current Mac arch
      if [ "$(uname -m)" = "arm64" ]; then
        echo "aarch64-apple-darwin"
      else
        echo "x86_64-apple-darwin"
      fi
      ;;
    mac-universal|macos-universal)
      echo "universal-apple-darwin"
      ;;
    windows|win)
      echo "x86_64-pc-windows-msvc"
      ;;
    windows-arm|win-arm)
      echo "aarch64-pc-windows-msvc"
      ;;
    *)
      echo ""
      ;;
  esac
}

TARGET=""
if [ -n "$PLATFORM" ]; then
  TARGET=$(resolve_target "$PLATFORM")
fi

case "$MODE" in
  full)
    build_full "$TARGET"
    ;;
  lite)
    build_lite "$TARGET"
    ;;
  all)
    build_full "$TARGET"
    build_lite "$TARGET"
    ;;
  *)
    echo "Usage: $0 [full|lite|all] [mac|windows|mac-universal|windows-arm]"
    exit 1
    ;;
esac

echo ""
echo "=== Build complete! ==="
echo "Artifacts in: $DESKTOP_DIR/src-tauri/target/"
