# 29: Readable job cards

**What to build:** Each job card shows a short readable title (not the raw prompt cut at 80 characters, `src/helpers/cli-job.ts:166`), which helper (Claude Code, Codex, Gemini CLI, Tidy), state, elapsed time, and when done a one-line plain summary of the result. Click to expand the full output. The core adds what the card needs to `job.state`: helper id, `startedAt` / `endedAt`, a short title (one the model passes to `start_helper`, else made from the task), the one-line summary and the full output (capped).

**Blocked by:** 25 Right panel with Canvas and Jobs tabs

**Status:** done

**Priority:** must-have

- [x] `job.state` events carry helper id, start and end times, a short title, and on done a one-line summary plus the full output (capped), checked through the event stream
- [x] `start_helper` takes an optional short `title`; without one the core makes one from the task
- [x] The card shows title, helper, state and a ticking elapsed time
- [x] A done card shows the one-line summary; clicking expands the full output
- [x] A failed card shows the fix in one line, expandable
- [x] `test/job-board-view.test.ts` covers the new card fields

## Comments

- 2026-11-15 (sidebar builder): `job.state` now carries `startedAt` / `endedAt`, and on done or failed a one-line `summary` plus the full `output` (capped at 8000, `src/core/jobs.ts`). The helper id is the job's `kind` (`claude-code`, `codex`, `gemini-cli`, `tidy`). `start_helper` takes an optional `title`; without one, `shortTitle(task)` (`src/helpers/cli-job.ts`) makes one (first sentence, no "please" / "can you", 48 chars max). Cards: helper pixel mark with a tooltip, title, state, ticking elapsed time, folder (or branch), summary line that expands to the output; cancel is a small X. Tests: `test/job-cards.test.ts` (event stream), `test/job-board-view.test.ts`. Not yet hand-checked in the Tauri app.
