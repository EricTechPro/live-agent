# 2. With no key, the window asks for it once and hands it to the core

**Status:** accepted (ticket 19, 2026-11-14). Changes the "no key" part of ADR 0001.

## Context
ADR 0001 kept the key out of the window entirely: `get.sh` asks on the terminal, and with no key
the core exits. Eric's first real install ran without a keyboard, so the installer skipped the
key and the app opened on "Core did not start: no Gemini key", with nothing to do but find a
hidden file and edit it.

## Decision
- With no key the core still starts, in a "needs key" state: LiveKit and the local API run, the
  chat (token service, agent session, voice room) does not. Chat routes answer 503; `GET /key`
  says `{ needed: true }`.
- The window shows "Paste your Gemini key" with a link to https://aistudio.google.com/apikey
  (opened by a Rust command with a fixed URL). The pasted key goes out in ONE request,
  `POST /key`, behind the per-launch token, and the input is cleared.
- The core checks the key's shape (one word, so it can never add a line to `.env`), checks it
  with Google (the doctor's cheap `GET models/gemini-3.8-live`, no tokens used), then writes
  `GEMINI_API_KEY=` into `<home>/.env` with mode 600 (temp file + rename, other lines kept),
  puts it in its own environment, and starts the chat. The window then starts the setup chat
  as on any first launch. No restart.
- The key is never returned by any endpoint, logged, or put in an event. Error answers are fixed
  sentences that never repeat it.
- `get.sh` still asks on the terminal (optional); skipped, it just says the app will ask.

## Why not keep the key out of the window completely
The only way to get it in without a terminal is through some UI, and this one is ours. The key
crosses the window once, over 127.0.0.1 with the launch token, and lives afterwards only where
ADR 0001 already put it: the core process and the 600 `.env`. The window still only ever
receives tokens.

## Consequences
- A key that works but is wrong for the user can only be changed in `.env` (then restart).
  `POST /key` answers 409 once the chat runs.
- Over-quota (429) counts as a working key: the key is fine, the quota is not the window's job.
