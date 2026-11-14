#!/bin/sh
# Pack the built live-agent.app into the tarball get.sh downloads, plus its checksum:
#   <out>/live-agent-darwin-arm64.tar.gz and .sha256
# Usage: sh scripts/package-release.sh [out-dir]   (after `bunx tauri build`)
# A stable asset name means get.sh needs no GitHub API call:
#   https://github.com/<repo>/releases/latest/download/live-agent-darwin-arm64.tar.gz
set -eu
cd "$(dirname "$0")/.."             # app/
OUT="$(mkdir -p "${1:-dist-release}" && cd "${1:-dist-release}" && pwd)"
APP=$(ls -d src-tauri/target/*/release/bundle/macos/live-agent.app src-tauri/target/release/bundle/macos/live-agent.app 2>/dev/null | head -1)
[ -n "$APP" ] || { echo "package-release: no live-agent.app; run bunx tauri build first" >&2; exit 1; }

# The checks a fresh Mac depends on: everything signed, both sidecars and the sample brain inside.
codesign -v --deep --strict "$APP"
test -x "$APP/Contents/MacOS/live-agent-core"
test -x "$APP/Contents/MacOS/livekit-server"
test -d "$APP/Contents/Resources/sample-brain/wiki"
# Both sidecars must actually run as signed in the bundle. The core loads rtc-node's native
# addon at start; with Tauri's hardened runtime that failed (Team ID mismatch), so check it.
"$APP/Contents/MacOS/live-agent-core" --version
"$APP/Contents/MacOS/livekit-server" --version

NAME=live-agent-darwin-arm64.tar.gz
tar -C "$(dirname "$APP")" -czf "$OUT/$NAME" live-agent.app
(cd "$OUT" && shasum -a 256 "$NAME" > "$NAME.sha256")
echo "package-release: $OUT/$NAME"
