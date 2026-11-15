# 15: Mini orb

**What to build:** A mini button shrinks the window into a small always-on-top floating orb that shows how many jobs are running. Clicking it opens the full window again. Idea from Roamies; no Roamies code (AGPL).

**Blocked by:** 10 Job board, bottom bar, mode switching

**Status:** ready-for-human

**Priority:** after-talk

- [x] Clicking mini shrinks to a floating orb that stays on top
- [x] The orb shows the running job count live
- [x] Clicking the orb restores the full window
- [ ] Voice keeps working in mini mode

## Comments

2026-11-14: unparked by Eric ("finish all the tickets").

**Built (agent, 2026-11-14).** A **Mini** button sits next to Setup and New chat. It calls the Rust
command `set_mini(on)` (`app/src-tauri/src/lib.rs`), which shrinks **the same window** to 132 x 132,
frameless, not resizable, always on top, in the screen's top-right corner, and remembers where the full
window was. The page only adds `body.mini` (`app/src/mini.ts`, CSS in `style.css`): the orb, its state
word (Listening / Thinking / Speaking) and a running-jobs badge stay; everything else hides. Clicking the
orb calls `set_mini(false)`. The space around the orb drags the frameless window
(`data-tauri-drag-region`, capability `core:window:allow-start-dragging`).

Why resize instead of a second window: the LiveKit room, the agent's audio element and the core's
event stream all live in this one webview. A second window would be a second page with no room (it
would need its own copy of every state), and hiding the main one could pause its audio. Resizing keeps
the page untouched, so nothing reconnects.

The count is `runningCount(board)` in `app/src/job-board.ts` (working jobs only; waiting ones are not
running yet), fed by the same job-board reducer. Tests: `test/mini-orb.test.ts`.

**Checked by the agent** (debug build, temp home with a copy of the sample brain, real Gemini Live,
fake `gemini` CLI that works for 40 s; no screen capture or accessibility access here, so window state
came from CoreGraphics' window list, and clicks came from a temporary timer build that was not committed):
- Mini: the window went from 960 x 600 at layer 0 to 132 x 132 at layer 5 (above normal windows), top right.
- While mini, a typed turn ("What is my sourdough starter called?") got "Gus" and a helper job ran
  queued -> running -> done; the agent announced it.
- Clicking the orb: back to layer 0 at the same top-left corner.
- The webview's LiveKit WebSocket (WebKit Networking process, same local port) stayed ESTABLISHED
  before, during and after mini mode: the room never disconnected.
- DOM (same built frontend in a browser with the Tauri call stubbed, real core): in mini only the orb,
  label and badge show; the badge went 0 -> 1 (and turned blue) while the job worked, live; clicking the
  orb brought the full layout back.

**Known gap:** on this macOS the restored window is one title bar (~32 px) taller than before (top-left
is exact). Tauri reports outer == inner size here, so the bar can't be measured to take it off.

**Needs a person** (box 4: real speech can't be driven by an agent): open the app, press Start talking,
press Mini, ask something out loud. You should hear the answer and see the orb go Thinking -> Speaking.
Click the orb, keep talking. Then tick box 4 and set Status to done.
