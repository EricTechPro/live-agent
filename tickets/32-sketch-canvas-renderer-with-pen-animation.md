# 32: Sketch canvas renderer with pen animation

**What to build:** The Canvas tab (ticket 25) draws `canvas.beat` marks on a canvas with hand-drawn pen strokes that animate from 0 to 1, one mark after another within a beat. Our own small renderer (slight wobble, round caps), no AGPL code. The board scales to the panel. A new chat clears it. Today's Mermaid panel stays reachable for `draw_diagram` until ticket 35.

**Blocked by:** 25 Right panel with Canvas and Jobs tabs, 31 `draw` tool: beats and Zod-checked marks

**Status:** ready-for-agent

**Priority:** must-have

- [ ] Every mark kind from ticket 31 draws on the canvas with an animated pen stroke
- [ ] Marks from a beat draw in order; a later beat adds to the canvas instead of replacing it
- [ ] The board scales with the panel and stays sharp on a Retina screen
- [ ] `chat.started` clears the canvas
- [ ] The canvas state (marks by id) is a pure reducer with a test
- [ ] Respects reduced motion: with it on, marks appear without the stroke animation
- [ ] Hand check in the real app: "draw how a voice question flows" draws step by step while Jett talks

## Comments
