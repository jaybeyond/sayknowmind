#!/usr/bin/env bash
# Download external CLIs that ship inside the desktop bundle as Tauri sidecars.
# Currently: codex (Rust native CLI from openai/codex GitHub releases).
#
# Tauri externalBin requires the binary file to be suffixed with the build
# target triple, e.g. `codex-aarch64-apple-darwin`. We resolve the host triple
# (or honor $TAURI_TARGET if set by the caller) and pull a single matching
# asset.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BIN_DIR="$DESKTOP_DIR/src-tauri/binaries"

# Pin the codex release so a freshly cut upstream release can't surprise the
# build. Bump intentionally.
CODEX_VERSION="${CODEX_VERSION:-rust-v0.130.0}"

mkdir -p "$BIN_DIR"

# ─── Resolve target triple ────────────────────────────────────────────────
# Honor TAURI_TARGET (cross-compile) → fall back to host rustc → fall back to
# uname-based guess so the script still works without rustc on PATH.
resolve_target() {
  if [ -n "${TAURI_TARGET:-}" ]; then
    echo "$TAURI_TARGET"
    return
  fi
  if command -v rustc >/dev/null 2>&1; then
    rustc -vV | awk '/^host:/ {print $2}'
    return
  fi
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os-$arch" in
    Darwin-arm64)  echo "aarch64-apple-darwin" ;;
    Darwin-x86_64) echo "x86_64-apple-darwin" ;;
    Linux-aarch64) echo "aarch64-unknown-linux-musl" ;;
    Linux-x86_64)  echo "x86_64-unknown-linux-musl" ;;
    *)             echo "unknown" ;;
  esac
}

TARGET="$(resolve_target)"
if [ "$TARGET" = "unknown" ]; then
  echo "[fetch-binaries] ERROR: could not determine target triple" >&2
  exit 1
fi
echo "[fetch-binaries] target: $TARGET"

# ─── codex ────────────────────────────────────────────────────────────────
# openai/codex releases use the same triple in their asset name, and Linux
# builds prefer the musl static binary for portability across distros.
case "$TARGET" in
  *-apple-darwin)
    ASSET="codex-${TARGET}.tar.gz"
    BIN_INSIDE="codex-${TARGET}"
    OUT_NAME="codex-${TARGET}"
    ;;
  aarch64-unknown-linux-gnu)
    # Upstream ships musl for arm64 Linux; the glibc target works fine with it.
    ASSET="codex-aarch64-unknown-linux-musl.tar.gz"
    BIN_INSIDE="codex-aarch64-unknown-linux-musl"
    OUT_NAME="codex-aarch64-unknown-linux-gnu"
    ;;
  x86_64-unknown-linux-gnu)
    ASSET="codex-x86_64-unknown-linux-musl.tar.gz"
    BIN_INSIDE="codex-x86_64-unknown-linux-musl"
    OUT_NAME="codex-x86_64-unknown-linux-gnu"
    ;;
  *-unknown-linux-musl)
    ASSET="codex-${TARGET}.tar.gz"
    BIN_INSIDE="codex-${TARGET}"
    OUT_NAME="codex-${TARGET}"
    ;;
  *-pc-windows-msvc)
    ASSET="codex-${TARGET}.exe.zip"
    BIN_INSIDE="codex-${TARGET}.exe"
    OUT_NAME="codex-${TARGET}.exe"
    ;;
  *)
    echo "[fetch-binaries] ERROR: no codex asset mapped for target $TARGET" >&2
    exit 1
    ;;
esac

OUT_PATH="$BIN_DIR/$OUT_NAME"
if [ -x "$OUT_PATH" ] && [ "${FORCE_REFETCH:-0}" != "1" ]; then
  echo "[fetch-binaries] codex already present at $OUT_PATH — skip (FORCE_REFETCH=1 to overwrite)"
  exit 0
fi

URL="https://github.com/openai/codex/releases/download/${CODEX_VERSION}/${ASSET}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
echo "[fetch-binaries] downloading $URL"
curl -fsSL "$URL" -o "$TMP_DIR/$ASSET"

case "$ASSET" in
  *.tar.gz) tar -xzf "$TMP_DIR/$ASSET" -C "$TMP_DIR" ;;
  *.zip)    unzip -q "$TMP_DIR/$ASSET" -d "$TMP_DIR" ;;
  *)        echo "[fetch-binaries] ERROR: unsupported archive $ASSET" >&2; exit 1 ;;
esac

if [ ! -f "$TMP_DIR/$BIN_INSIDE" ]; then
  echo "[fetch-binaries] ERROR: expected $BIN_INSIDE inside archive" >&2
  ls -la "$TMP_DIR" >&2
  exit 1
fi

install -m 0755 "$TMP_DIR/$BIN_INSIDE" "$OUT_PATH"
echo "[fetch-binaries] codex installed → $OUT_PATH ($(du -h "$OUT_PATH" | cut -f1))"
