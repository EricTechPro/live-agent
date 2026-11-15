# 30: Speech bubble and transcript polish

**What to build:** Two text bugs from Eric's screenshot, both real in the code.
- The bubble over the orb cut the line: "SENDING THAT TO CLAUDE CODE.MAY I…". `bubbleLine` keeps only the first 38 characters of the reply's first line (`app/src/main.ts:56-58`). Show the latest sentence in full (wrap to two lines, then cut at a word), not a fixed character count of the whole reply.
- A missing space after a period: "Claude Code.May". The model's text arrives in separate segments (before and after a tool call), and they are joined with no space in the transcript (`app/src/transcript.ts:23`) and in the turn's reply (`src/core/agent.ts:305`). Join segments with a space when the first ends with sentence punctuation and the next starts without a space.

**Blocked by:** None

**Status:** ready-for-agent

**Priority:** must-have

- [ ] Two model segments "Sending that to Claude Code." and "May I start it?" show as "Sending that to Claude Code. May I start it?" in the transcript (reducer test)
- [ ] The `turn.done` reply has the same space (event stream test)
- [ ] Chunks inside one word or one sentence are still joined with no extra space
- [ ] The bubble shows the latest sentence in full, up to two lines, cut at a word only when longer
- [ ] Hand check in the real app: a helper request shows a clean bubble and transcript

## Comments
