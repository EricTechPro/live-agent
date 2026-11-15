# 31: `draw` tool: beats and Zod-checked marks

**What to build:** A new `draw` tool (risk `read`, NON_BLOCKING) shaped as `beats: [{ say, marks[] }]`. Marks are small shapes checked with Zod (new core dependency): `box`, `text`, `arrow`, `line`, `circle` (ring), `underline`, `check`, `cross`, `step` (numbered). Each mark has an id (`p1`, `p2`, …), unique on the canvas, on a fixed virtual board (for example 1000 × 600). The core emits one `canvas.beat` event per beat with the checked marks. Bad marks are a tool error the model hears, and nothing reaches the window. `draw_diagram` stays for now (ticket 35 retires it). Roamies inspired this; it is AGPL, borrow ideas only, never code. See the spec addendum "Sketch canvas".

**Blocked by:** None

**Status:** done

**Priority:** must-have

- [x] `draw` is a tool in `tools/` with a JSON schema the Live model accepts, and is in the bundled tool list
- [x] Every mark kind has a Zod schema; ids and coordinates are checked
- [x] A good call emits `canvas.beat` events in order, after the tool call and allow verdict (scripted fake model test)
- [x] A bad mark (unknown kind, missing id, duplicate id, off the board) fails the call with a message the model hears, and no `canvas.*` event is emitted
- [x] The system prompt tells the model when to draw and to keep it to a few marks per beat

## Comments

- 2026-11-15 (core builder): schemas in `src/core/canvas.ts` (board 1000 x 600, ids `p<n>`, colours ink/red/blue/green/orange/purple, at most 8 beats and 12 marks per beat), tool in `tools/draw.ts` with a flat JSON schema (no oneOf, for Gemini Live). Ids stay unique across calls until a new chat clears the board. Event: `{ type: "canvas.beat", id, beat, say, marks }`, all beats emitted at once (ticket 34 times them to the voice). Tests: `test/draw.test.ts`. Not yet checked against real Gemini Live: the smoke run should confirm the model accepts the schema.
