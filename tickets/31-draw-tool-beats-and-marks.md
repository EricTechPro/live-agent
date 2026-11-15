# 31: `draw` tool: beats and Zod-checked marks

**What to build:** A new `draw` tool (risk `read`, NON_BLOCKING) shaped as `beats: [{ say, marks[] }]`. Marks are small shapes checked with Zod (new core dependency): `box`, `text`, `arrow`, `line`, `circle` (ring), `underline`, `check`, `cross`, `step` (numbered). Each mark has an id (`p1`, `p2`, …), unique on the canvas, on a fixed virtual board (for example 1000 × 600). The core emits one `canvas.beat` event per beat with the checked marks. Bad marks are a tool error the model hears, and nothing reaches the window. `draw_diagram` stays for now (ticket 35 retires it). Roamies inspired this; it is AGPL, borrow ideas only, never code. See the spec addendum "Sketch canvas".

**Blocked by:** None

**Status:** ready-for-agent

**Priority:** must-have

- [ ] `draw` is a tool in `tools/` with a JSON schema the Live model accepts, and is in the bundled tool list
- [ ] Every mark kind has a Zod schema; ids and coordinates are checked
- [ ] A good call emits `canvas.beat` events in order, after the tool call and allow verdict (scripted fake model test)
- [ ] A bad mark (unknown kind, missing id, duplicate id, off the board) fails the call with a message the model hears, and no `canvas.*` event is emitted
- [ ] The system prompt tells the model when to draw and to keep it to a few marks per beat

## Comments
