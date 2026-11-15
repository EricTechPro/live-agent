# 1. The Gemini key lives in `~/Desktop/live-agent/.env`, read only by the core

**Status:** accepted (ticket 13, 2026-11-14)

## Context
Opened from Finder, the app gets no terminal: no key in the environment, no working folder,
a bare PATH. The setup chat itself runs on Gemini, so the key must exist before the first chat.
Spec user story 12: the real key must never reach the window (front end).

## Decision
- `get.sh` asks for the key on the terminal (hidden input, read from `/dev/tty` so it works
  under `curl | bash`) and writes `~/Desktop/live-agent/.env` as `GEMINI_API_KEY=...` with mode 600.
  Skipped or no terminal: it writes an empty `GEMINI_API_KEY=` line and says where to paste it.
  A re-run (upgrade) never rewrites an existing `.env`.
- The Tauri shell passes `LIVE_AGENT_HOME` (default `~/Desktop/live-agent`) to the core sidecar.
  The core (`src/home.ts`) works from that folder and loads its `.env`; a key already in the
  environment wins. The window only gets the launch token and short-lived LiveKit tokens.

## Why not the macOS Keychain
More code on both sides (Rust or `security` calls, a key-entry UI in the window that would then
have to carry the key to the core) for little gain on a single-user laptop. The `.env` is the
same file developers already use, the doctor fix text already points at it, and mode 600 keeps
other users out. Keychain can come later without changing the core: the shell would put the
key in the sidecar's environment, which already wins over `.env`.

## Consequences
- ~~With no key the core exits with "no Gemini key. Put GEMINI_API_KEY=... in <home>/.env" and the
  window shows that reason.~~ Changed by ADR 0002 (ticket 19): with no key the core waits and the
  window asks for it once, then the core saves it to the same `.env`.
- The key is plain text on disk (like every `.env`); the folder is the user's own Desktop.
