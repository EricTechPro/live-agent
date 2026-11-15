#!/usr/bin/env bash
# live-agent one-line installer (macOS, Apple Silicon).
#
#   curl -fsSL https://raw.githubusercontent.com/EricTechPro/live-agent/main/get.sh | bash
#
# Downloads the ready-built app from GitHub Releases (no Rust needed), puts it in
# /Applications (or ~/Applications), makes ~/Desktop/live-agent with the sample
# brain and your Gemini key, runs `live-agent doctor`, and opens the app into the
# setup chat. Run it again to upgrade: your brain, config and key are kept.
#
# Options:
#   --ref <tag>     install this release (default: the latest)
#   --no-open       don't open the app at the end
#   -h, --help      show this help
#
# Environment:
#   LIVE_AGENT_REPO      GitHub owner/repo (default EricTechPro/live-agent)
#   LIVE_AGENT_TARBALL   exact app tarball URL (file:// works; used by tests and CI)
#   LIVE_AGENT_HOME      the live-agent folder (default ~/Desktop/live-agent)
#   LIVE_AGENT_APPS      where the app goes (default /Applications, else ~/Applications)
#   LIVE_AGENT_TTY       where to read the key from (default /dev/tty; /dev/null skips)
#
# Written for bash 3.2 (stock macOS). The whole script lives in main(), called on
# the last line, so a download cut off halfway through runs nothing.

set -euo pipefail

say()  { printf '%s\n' "$*"; }
warn() { printf '⚠️  %s\n' "$*" >&2; }
die()  { printf '❌ %s\n' "$*" >&2; exit "${2:-1}"; }
have() { command -v "$1" >/dev/null 2>&1; }

usage() { sed -n '2,24p' "${BASH_SOURCE[0]:-$0}" 2>/dev/null | sed 's/^# \{0,1\}//' || true; }

ASSET="live-agent-darwin-arm64.tar.gz"

main() {
  local ref="" open_app=1
  local repo="${LIVE_AGENT_REPO:-EricTechPro/live-agent}"
  local home="${LIVE_AGENT_HOME:-$HOME/Desktop/live-agent}"
  local tty="${LIVE_AGENT_TTY:-/dev/tty}"

  while [ $# -gt 0 ]; do
    case "$1" in
      --ref) [ $# -ge 2 ] || die "--ref needs a release tag, like v0.1.0" 64; ref="$2"; shift 2 ;;
      --ref=*) ref="${1#--ref=}"; shift ;;
      --no-open) open_app=0; shift ;;
      -h|--help) usage; exit 0 ;;
      *) die "unknown option: $1 (try --help)" 64 ;;
    esac
  done

  # --- safety -----------------------------------------------------------
  [ "$(id -u)" -ne 0 ] || die "please don't run this with sudo. Run it as your normal user." 1
  [ "$(uname -s)" = Darwin ] || die "live-agent is macOS-only for now." 69
  [ "$(uname -m)" = arm64 ] || die "this build is for Apple Silicon Macs (M1 or newer)." 69
  have curl && have tar && have shasum || die "I need curl, tar and shasum (they come with macOS)." 69

  say "🎙️  live-agent installer"

  # --- download -----------------------------------------------------------
  local tmp; tmp="$(mktemp -d)"
  trap "rm -rf '$tmp'" EXIT
  local url="${LIVE_AGENT_TARBALL:-}"
  if [ -z "$url" ]; then
    if [ -n "$ref" ]; then url="https://github.com/$repo/releases/download/$ref/$ASSET"
    else url="https://github.com/$repo/releases/latest/download/$ASSET"; fi
  fi
  say "📦 downloading ${ref:-the latest release}"
  curl -fsSL "$url" -o "$tmp/app.tgz" || die "download failed: $url" 1
  # The release has a .sha256 next to the tarball; check it when it's there.
  if curl -fsSL "$url.sha256" -o "$tmp/sum" 2>/dev/null; then
    local want got
    want="$(awk '{print $1; exit}' "$tmp/sum")"
    got="$(shasum -a 256 "$tmp/app.tgz" | awk '{print $1}')"
    [ "$want" = "$got" ] || die "checksum mismatch: the download is broken. Run this again." 1
  fi
  mkdir "$tmp/x"
  tar -xzf "$tmp/app.tgz" -C "$tmp/x" || die "the download is not a valid app archive." 1
  [ -d "$tmp/x/live-agent.app" ] || die "the download has no live-agent.app inside." 1

  # --- install the app ------------------------------------------------------
  local apps="${LIVE_AGENT_APPS:-}"
  if [ -z "$apps" ]; then
    if [ -w /Applications ]; then apps=/Applications; else apps="$HOME/Applications"; fi
  fi
  mkdir -p "$apps"
  local app="$apps/live-agent.app"
  if [ -d "$app" ]; then
    say "🔁 upgrading $app"
    # The old app must not be running while it is replaced (only this copy is stopped).
    pkill -f "$app/Contents/MacOS/" 2>/dev/null || true
    rm -rf "$app"
  fi
  mv "$tmp/x/live-agent.app" "$app"
  # curl sets no quarantine flag, but clear it anyway: the app is ad-hoc signed, not notarized.
  xattr -dr com.apple.quarantine "$app" 2>/dev/null || true
  say "✅ app installed: $app"

  # --- the Desktop folder: add what's missing, never overwrite ----------------
  mkdir -p "$home"
  if [ -d "$home/sample-brain" ]; then
    say "🧠 kept your brain: $home/sample-brain"
  else
    cp -R "$app/Contents/Resources/sample-brain" "$home/sample-brain"
    say "🧠 sample brain: $home/sample-brain"
  fi
  [ ! -f "$home/live-agent.config.json" ] || say "⚙️  kept your config: $home/live-agent.config.json"

  # The Gemini key lives in $home/.env, readable only by you. Only the app's core
  # reads it; the window never sees it (it gets short-lived tokens instead).
  local env="$home/.env"
  if [ -f "$env" ]; then
    say "🔑 kept your key file: $env"
  else
    local key=""
    if { : < "$tty"; } 2>/dev/null; then
      printf '🔑 Paste your Gemini key (from https://aistudio.google.com/apikey), or press Enter to paste it in the app later: ' >&2
      { IFS= read -r -s key < "$tty" || true; } 2>/dev/null
      printf '\n' >&2
    fi
    key="$(printf '%s' "$key" | tr -d '[:space:]')"
    ( umask 077; printf 'GEMINI_API_KEY=%s\n' "$key" > "$env" )
    chmod 600 "$env"
    # Skipped (or no keyboard): fine. The app opens on "Paste your Gemini key" and saves it here.
    if [ -n "$key" ]; then say "🔑 key saved: $env"
    else say "🔑 the app will ask for your Gemini key when it opens (it saves it in $env)."; fi
  fi

  # --- check, then open -----------------------------------------------------
  say "🩺 live-agent doctor"
  LIVE_AGENT_HOME="$home" "$app/Contents/MacOS/live-agent-core" doctor \
    || warn "doctor found problems (see above). The setup chat will help you fix them."

  if [ "$open_app" -eq 1 ]; then
    say "🚀 opening live-agent: the setup chat starts on first launch"
    open "$app"
  fi
  say "🎉 live-agent is installed. Your folder: $home"
}

main "$@"
