# 02: Read-file tool behind the safety gate

**What to build:** The agent can read a file the user names, and every tool call first passes one safety gate. Tools load from one tools folder and each declares a risk class (read, edit, command, helper). The gate returns allow, ask, or block using the mode table in the spec (Ask me / Auto edits / Bypass). Every verdict goes to the event stream. Blocked calls are explained by the agent in its own voice. Tools run NON_BLOCKING so the voice never waits.

**Blocked by:** 01 Text turn through the agent core

**Status:** done

**Priority:** must-have

- [x] Asking about a named file produces a tool-call event and an answer that uses its content
- [x] Fast tests cover every risk class in every mode and match the spec's mode table
- [x] A blocked call produces a block verdict event and a spoken-style explanation, and the tool does not run
- [x] In Ask me mode, an ask verdict waits for a yes turn, and a yes lets the tool run
- [x] Every tool call, allowed or not, appears in the event stream
- [x] Adding a new tool means dropping one file in the tools folder

## Comments

- 2026-11-14 review fix: the server's toolCallCancellation is handled. A cancelled call shows as `tool.result` status `cancelled`; a waiting call stops waiting, and a running tool's late answer is not sent to the model.
