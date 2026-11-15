# 29: Readable job cards

**What to build:** Each job card shows a short readable title (not the raw prompt cut at 80 characters, `src/helpers/cli-job.ts:166`), which helper (Claude Code, Codex, Gemini CLI, Tidy), state, elapsed time, and when done a one-line plain summary of the result. Click to expand the full output. The core adds what the card needs to `job.state`: helper id, `startedAt` / `endedAt`, a short title (one the model passes to `start_helper`, else made from the task), the one-line summary and the full output (capped).

**Blocked by:** 25 Right panel with Canvas and Jobs tabs

**Status:** ready-for-agent

**Priority:** must-have

- [ ] `job.state` events carry helper id, start and end times, a short title, and on done a one-line summary plus the full output (capped), checked through the event stream
- [ ] `start_helper` takes an optional short `title`; without one the core makes one from the task
- [ ] The card shows title, helper, state and a ticking elapsed time
- [ ] A done card shows the one-line summary; clicking expands the full output
- [ ] A failed card shows the fix in one line, expandable
- [ ] `test/job-board-view.test.ts` covers the new card fields

## Comments
