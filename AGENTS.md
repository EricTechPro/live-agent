# live-agent: notes for agents

## What this is
A light desktop app (Tauri) you talk to. Gemini Live is the boss: it hears, thinks and speaks.
It reads a second brain (`raw`, `wiki`, `projects`), saves notes, and starts helper agents.
Full plan: `docs/spec.md`. Decisions and reasons: `docs/plan.md`.

## Tickets
Tickets live in the `tickets/` folder, one file per ticket, numbered in build order.
Each ticket lists the tickets that block it. Work only tickets whose blockers are done.
When a ticket is done, tick its boxes and set `**Status:** done` in the same commit.
`must-have` tickets are needed for DevFest (Nov 27). `after-talk` tickets can wait.

## Testing
One seam: the agent core's event stream. Send a text turn in, check the events out
(transcript, tool calls, safety verdicts, job states, notes used, brain writes).
Fast tests use a scripted fake model. A live smoke test uses real Gemini Live.

## Commit style
Same as super-board: `<emoji> [type] scope: short lowercase summary (#issue)`

- `✨ [feat]` new behaviour
- `🐛 [fix]` bug fix
- `♻️ [refactor]` same behaviour, better code
- `🧪 [test]` tests only
- `📝 [docs]` docs only
- `💄 [ui]` look and feel
- `🔒 [security]` safety and secrets

Example: `✨ [feat] brain: report which notes each answer used (#4)`

## Rules
- Never commit a real brain or a real API key.
- Roamies is AGPL. Borrow ideas, never code.
