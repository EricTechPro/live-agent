# 13: One-command install and ready-built app

**What to build:** A new user runs one command (like super-board's installer). It downloads the ready-built app from GitHub Releases, creates the live-agent folder on the Desktop with the sample brain, runs doctor, and opens the app into the setup chat. Nobody needs Rust. macOS first.

**Blocked by:** 10 Job board, bottom bar, mode switching, 11 Doctor check, 12 Setup chat writes the config

**Status:** ready-for-human

**Priority:** must-have

- [ ] One command on a fresh Mac ends with the app open in the setup chat
- [x] The Desktop folder contains the sample brain and a config after setup
- [x] Running the command again upgrades without touching the user's brain or config
- [ ] Releases are built by CI, not by hand
- [ ] The install is tested on a clean machine in CI

## Comments

**Built (agent, 2026-11-14).**
- `get.sh` (bash 3.2, whole script in `main()`): downloads `live-agent-darwin-arm64.tar.gz` from the
  latest GitHub Release of EricTechPro/live-agent (checks the `.sha256` beside it), installs to
  `/Applications` (or `~/Applications`), makes `~/Desktop/live-agent` with `sample-brain/` (the default
  `brainPath`, so it works with no config), asks for the Gemini key on `/dev/tty` and writes `.env` mode 600,
  runs `live-agent-core doctor`, opens the app (no config yet, so the setup chat starts).
  Re-run = upgrade: only the app is replaced; existing `sample-brain/`, config and `.env` are kept.
  Overrides for tests: `LIVE_AGENT_TARBALL` (file://), `LIVE_AGENT_HOME`, `LIVE_AGENT_APPS`, `LIVE_AGENT_TTY`.
  Tests: `test/get-sh.test.ts` (fake release tarball, temp HOME).
- From Finder: the shell passes `LIVE_AGENT_HOME` (default `~/Desktop/live-agent`); the core (`src/home.ts`)
  works from there (config + relative brain path), loads the key from its `.env`, and adds Homebrew dirs
  to PATH for helper CLIs. `livekit-server` 1.13.11 is bundled (`Contents/MacOS/livekit-server`) and used
  before PATH. LiveKit has no macOS release binaries, so `app/scripts/fetch-livekit.sh` builds the pinned
  tag with Go. The /check page is now embedded in the compiled core (text import).
- Key storage: `.env` in the Desktop folder, read only by the core. See `docs/adr/0001-key-in-desktop-folder-env.md`.
- Found while testing: Tauri's default hardened runtime made the bundled core fail to load rtc-node's
  native addon (Team ID mismatch). `hardenedRuntime: false` (ad-hoc signed, not notarized);
  `app/scripts/package-release.sh` now runs both sidecars from the bundle as a check.
- `.github/workflows/release.yml`: on a `v*` tag or by hand. build (bun 1.4.4, Go, Rust, `tauri build`,
  `codesign -v`, pack) -> install-test on a fresh macos-latest (runs get.sh like a user, checks folder,
  brain, key file 600, no config before setup, the opened app starts its bundled LiveKit, upgrade keeps
  files) -> release (tags only: creates the GitHub Release with the tarball, only after the install test passed).

**Verified locally:** release build (`bunx tauri build`, 159 MB .app), packed, `get.sh` from file:// into a
temp HOME with a dummy key: app installed, folder + sample brain + `.env` (600); doctor ran from the app
(read the dummy key from the folder; Google rejected it as expected; LiveKit ok). Second run: every file in
the folder byte-identical. Opened with `open` (launchd env, only `LIVE_AGENT_HOME` set): the app started
`live-agent-core`, which started the bundled `Contents/MacOS/livekit-server`, then stopped on the dummy key
(API_KEY_INVALID). With an empty `.env` it says where to put the key. Not run with a real key (by rule).

**Still open (needs the real GitHub run):** box 1 (fresh Mac ends in the setup chat with a real key),
box 4 (Releases built by CI) and box 5 (install tested on a clean machine in CI) tick after the first
`v*` tag run of `release.yml` passes.
