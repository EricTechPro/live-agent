# 10: Job board, bottom bar, mode switching

**What to build:** The right side of the window shows a small job board: each helper job with waiting, working, done or failed, and a cancel button. A bottom bar shows which brain notes the last answer used and the current safety mode. Shift+Tab cycles Ask me, Auto edits and Bypass; a dropdown in the bottom bar does the same.

**Blocked by:** 04 Brain answers with notes used, 06 Helper jobs with Gemini CLI, 09 Desktop window: orb, transcript, talk out loud

**Status:** done

**Priority:** must-have

- [x] Starting a helper job by voice shows it on the board and it moves through states live
- [x] Clicking cancel on a job cancels it
- [x] The bottom bar shows notes used after a brain answer
- [x] Shift+Tab cycles the three modes and the gate uses the new mode immediately
- [x] The dropdown and Shift+Tab always show the same mode

## Comments

**How it works.** Core: `session.mode()`, `setMode(mode)`, `cycleMode()`; the gate reads the
current mode on every call, and each change emits `{ type: "mode.changed", mode }`. Window API
(`src/app.ts`, all behind the per-launch token): `GET /mode`, `POST /mode` with `{ mode }` or
`{ cycle: true }`, `POST /jobs/:id/cancel` (404 for an unknown id). Window: pure reducers
`app/src/job-board.ts` (job.state -> rows: waiting/working/done/failed/cancelled, cancel button
only while waiting or working) and `app/src/bottom-bar.ts` (notes used by the last finished answer;
mode only from `mode.changed`), rendered by `app/src/board-view.ts`. Shift+Tab is an in-window
keydown that asks the core to cycle; the dropdown asks it to set. Both draw only from the core's
`mode.changed`, so they cannot disagree. `GET /mode` is used once for the first draw.

**Tests.** `test/mode-switch.test.ts` (the next tool call uses the new mode; mode.changed on the
stream; cycle order), `test/app.test.ts` (the endpoints, 400/404/401), `test/job-board-view.test.ts`
(reducers, Shift+Tab key match).

**Checked in the built app** (`bunx tauri build --debug`; built frontend served by `vite preview`,
opened in Playwright WebKit with the Tauri call stubbed, as in ticket 09) against a running core with
real Gemini Live, a temp copy of the sample brain, and a fake Gemini CLI (12 s of work):
- Shift+Tab x3 went Bypass -> Ask me -> Auto edits; dropdown to Ask me, then Shift+Tab -> Auto edits;
  Shift+Tab from inside the text box -> Bypass. After every step the dropdown matched `GET /mode`.
- "What is my sourdough starter called?" -> bar showed `Notes used wiki/sourdough-starter.md`.
- "Start a helper to tidy the README" (Bypass: verdict allow) -> job-1 showed Working at once and went
  queued -> running -> done live. A second helper showed Waiting (max 1 at once); its Cancel button
  made it Cancelled. A third was cancelled while Working (queued -> running -> cancelled).
- Shift+Tab to Ask me, then the next helper request got verdict `ask` in `ask-me`, and no job ran.

"By voice" was checked with typed turns: a typed turn and a spoken turn go through the same core
path (same tool call, same `job.state` events), and mic input can't be driven by an agent.

**Found while checking (not fixed here):** with the ephemeral-token connection that `src/main.ts`
uses, Gemini Live answered "I cannot use external tools" (no tool calls at all, twice). The same
check with a direct-key connection (`geminiLiveModel({ apiKey })`) called every tool, and all the
checks above passed with it. So tools seem to be dropped on the v1alpha ephemeral-token path
(`src/voice/token-service.ts` / `src/models/gemini-live.ts`); this needs its own fix.
