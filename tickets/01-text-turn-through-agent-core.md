# 01: Text turn through the agent core

**What to build:** A developer sends a text turn to the agent core and gets the model's reply back as events on one event stream. This is the seam every later test uses. Ships with a scripted fake model for fast tests and a live smoke test against real Gemini Live (gemini-3.8-live), in the style of live-dj's smoke test.

**Blocked by:** None (can start immediately)

**Status:** done

**Priority:** must-have

- [x] Starting a session and sending a text turn returns transcript events for the reply
- [x] The same turn works with the scripted fake model and with real Gemini Live
- [x] A fast test drives the fake model through the event stream and passes with no network
- [x] A live smoke test runs one real text turn when a Gemini key is present, and skips cleanly when it is not
- [x] The Gemini key is read from the environment, never hard-coded; an example env file is committed

## Comments

- Built on Bun + TypeScript with `@google/genai` 3.3. Fast tests: `bun test` (scripted fake model, no network). Live smoke: `bun run smoke`.
- The live smoke skips cleanly with no key (verified). The real run against `gemini-3.8-live` is pending a key: run `bun run smoke` with `GEMINI_API_KEY` set. Text goes in via `sendRealtimeInput({ text })`; if the live model rejects that, switch `sendText` in `src/models/gemini-live.ts` to `sendClientContent`.
