#!/bin/sh
# Put a pinned livekit-server where Tauri's externalBin expects it:
# src-tauri/binaries/livekit-server-<target-triple>. It ships inside the app
# (Contents/MacOS/livekit-server), so nobody needs `brew install livekit`.
#
# Why build from source: LiveKit's GitHub releases have no macOS binaries
# (only Homebrew builds them). So we build the pinned tag with Go, the same
# way locally and in CI. LIVEKIT_SERVER_BIN=/path skips the build and copies
# that binary instead (it must report the pinned version).
set -eu
cd "$(dirname "$0")/.."             # app/
export PATH="$HOME/.cargo/bin:$PATH"

LIVEKIT_VERSION=1.13.11
TRIPLE=$(rustc --print host-tuple)
OUT="src-tauri/binaries/livekit-server-$TRIPLE"
mkdir -p src-tauri/binaries

if [ -x "$OUT" ] && "$OUT" --version 2>/dev/null | grep -q " $LIVEKIT_VERSION\$"; then
  echo "fetch-livekit: $OUT is already $LIVEKIT_VERSION"
  exit 0
fi

if [ -n "${LIVEKIT_SERVER_BIN:-}" ]; then
  "$LIVEKIT_SERVER_BIN" --version | grep -q " $LIVEKIT_VERSION\$" \
    || { echo "fetch-livekit: $LIVEKIT_SERVER_BIN is not livekit-server $LIVEKIT_VERSION" >&2; exit 1; }
  install -m 755 "$LIVEKIT_SERVER_BIN" "$OUT"
else
  command -v go >/dev/null 2>&1 || { echo "fetch-livekit: needs Go (brew install go) or LIVEKIT_SERVER_BIN" >&2; exit 1; }
  SRC="${TMPDIR:-/tmp}/livekit-src-$LIVEKIT_VERSION"
  [ -d "$SRC" ] || git clone --quiet --depth 1 --branch "v$LIVEKIT_VERSION" https://github.com/livekit/livekit "$SRC"
  (cd "$SRC" && go build -trimpath -ldflags "-s -w" -o "$OLDPWD/$OUT" ./cmd/server)
fi

"$OUT" --version
if [ "$(uname)" = Darwin ]; then
  codesign -v "$OUT"
  echo "fetch-livekit: codesign -v ok: $OUT"
fi
