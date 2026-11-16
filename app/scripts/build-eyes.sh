#!/bin/sh
# Build jett-eyes (src-tauri/eyes/main.swift), Jett's screen helper, where Tauri's
# externalBin expects it: src-tauri/binaries/jett-eyes-<target-triple>.
# macOS only (ScreenCaptureKit); on other systems it writes a stub that says so.
set -eu
cd "$(dirname "$0")/.."             # app/
export PATH="$HOME/.cargo/bin:$PATH"

TRIPLE=$(rustc --print host-tuple)
OUT="src-tauri/binaries/jett-eyes-$TRIPLE"
mkdir -p src-tauri/binaries

if [ "$(uname)" != Darwin ]; then
  printf '#!/bin/sh\necho %s\nexit 1\n' "'{\"error\":\"seeing the screen is macOS only for now\"}'" > "$OUT"
  chmod +x "$OUT"
  exit 0
fi

case "$TRIPLE" in
  aarch64-apple-darwin) ARCH=arm64 ;;
  x86_64-apple-darwin)  ARCH=x86_64 ;;
  *) echo "build-eyes: no swift target for $TRIPLE" >&2; exit 1 ;;
esac

swiftc -O -target "$ARCH-apple-macos12.0" src-tauri/eyes/main.swift -o "$OUT"
codesign -f -s - "$OUT"
codesign -v "$OUT"
echo "build-eyes: ok: $OUT"
