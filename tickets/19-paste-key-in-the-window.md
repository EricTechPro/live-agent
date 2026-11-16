# 19: Paste your key in the window

**What to build:** When the app starts with no Gemini key, the window shows a "Paste your Gemini key" screen instead of an error. It links to https://aistudio.google.com/apikey. The core checks the key works, saves it to `.env` in the live-agent folder (readable only by you), starts up, and goes straight into the setup chat. The key passes through the window once, when pasted, and is never stored or shown there again. The installer's terminal prompt stays, but is optional. Found in Eric's first real install: run without a keyboard, the installer skipped the key and the app opened on "Core did not start: no Gemini key".

**Blocked by:** 12 Setup chat writes the config, 13 One-command install

**Status:** done

**Priority:** must-have

- [x] Opening the app with no key shows the paste-your-key screen, not an error
- [x] A bad key is refused with a plain message, and nothing is saved
- [x] A good key is saved with only-you permissions, and the app moves on to the setup chat without a restart
- [x] The key never comes back to the window and is never written to a log
- [x] The installer run with no keyboard ends with the app open on the key screen

## Comments

- 2026-11-14 done: with no key the core starts in a "needs key" state (LiveKit + local API up, no chat; chat routes answer 503). `GET /key` / `POST /key` behind the launch token; the core checks the key with the doctor's cheap model lookup (`verifyGeminiKey` in `src/gemini-key.ts`), writes `<home>/.env` atomically with mode 600 (`saveGeminiKey` in `src/home.ts`), then starts the chat. Decision in docs/adr/0002. Verified with the built core binary + built frontend (Playwright, Chromium): key screen, bad key refused with nothing saved, real key saved 600 and the setup chat spoke first; the key was in no response, DOM or core log. The doctor still has its own copy of the key check (left alone because ticket 20 edits the doctor); it can call `verifyGeminiKey` later.
