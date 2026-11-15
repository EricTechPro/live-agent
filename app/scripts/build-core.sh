#!/bin/sh
# Build the agent core (src/main.ts) into one binary and put it where Tauri's
# externalBin expects it: src-tauri/binaries/live-agent-core-<target-triple>.
#
# Why bun 1.4.4 via npx: binaries from bun 1.3.x `--compile` get SIGKILLed on
# current macOS (bad ad-hoc signature). 1.4.4 signs correctly; codesign -v checks it.
set -eu
cd "$(dirname "$0")/.."             # app/
export PATH="$HOME/.cargo/bin:$PATH"

TRIPLE=$(rustc --print host-tuple)
case "$TRIPLE" in
  aarch64-apple-darwin) BUN_TARGET=bun-darwin-arm64 ;;
  x86_64-apple-darwin)  BUN_TARGET=bun-darwin-x64 ;;
  x86_64-unknown-linux-gnu) BUN_TARGET=bun-linux-x64 ;;
  *) echo "build-core: no bun target for $TRIPLE" >&2; exit 1 ;;
esac
OUT="src-tauri/binaries/live-agent-core-$TRIPLE"

mkdir -p src-tauri/binaries
npx --yes bun@1.4.4 build ../src/main.ts --compile --no-compile-autoload-dotenv --no-compile-autoload-bunfig --target="$BUN_TARGET" --outfile "$OUT"

if [ "$(uname)" = Darwin ]; then
  codesign -v "$OUT"
  echo "build-core: codesign -v ok: $OUT"
fi
