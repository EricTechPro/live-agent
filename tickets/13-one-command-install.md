# 13: One-command install and ready-built app

**What to build:** A new user runs one command (like super-board's installer). It downloads the ready-built app from GitHub Releases, creates the live-agent folder on the Desktop with the sample brain, runs doctor, and opens the app into the setup chat. Nobody needs Rust. macOS first.

**Blocked by:** 10 Job board, bottom bar, mode switching, 11 Doctor check, 12 Setup chat writes the config

**Status:** ready-for-agent

**Priority:** must-have

- [ ] One command on a fresh Mac ends with the app open in the setup chat
- [ ] The Desktop folder contains the sample brain and a config after setup
- [ ] Running the command again upgrades without touching the user's brain or config
- [ ] Releases are built by CI, not by hand
- [ ] The install is tested on a clean machine in CI
