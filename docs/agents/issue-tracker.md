# Issue tracker: Local Markdown

Specs and tickets for this repo live as markdown files in the repo. There is no GitHub Issues tracking.

## Conventions

- The spec is `docs/spec.md`. The decisions behind it are in `docs/plan.md`.
- Tickets are one file per ticket in `tickets/<NN>-<slug>.md`, numbered from `01` in build order. Never one combined file.
- Each ticket has a `**Blocked by:**` line listing ticket numbers, or "None".
- Each ticket has a `**Status:**` line (see `triage-labels.md`), and a `**Priority:**` line: `must-have` (needed for DevFest, Nov 27) or `after-talk`.
- Comments and history go at the bottom of the file under a `## Comments` heading.

## Frontier

A ticket is ready when its status is `ready-for-agent` and every ticket in its `Blocked by` line is `done`. Lowest number first. Do `must-have` before `after-talk`.

A blocker that is `ready-for-human` because its only open boxes need a person (a manual check on a real machine, a mic, a clean Mac) counts as `done` for its dependents: the code they build on is finished, and agents can't tick those boxes anyway. The user decided this on 2026-11-14 (tickets 10 to 14 were built while 08 and 09 waited on manual checks).

## When a skill says "publish to the issue tracker"

Create a new file in `tickets/` with the next free number.

## When a skill says "fetch the relevant ticket"

Read the file in `tickets/`. The user will normally pass the number (for example `01`) or the path.

## Closing work

A ticket is closed by ticking its acceptance boxes and setting `**Status:** done`, in the same commit as the work, on the integration branch. No pull requests are needed unless the user asks for one. Commit messages follow the style in `CLAUDE.md` and end with the ticket number, for example `(#04)`.
