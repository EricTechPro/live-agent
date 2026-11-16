# 35: Retire `draw_diagram`: Mermaid becomes a diagram card mark

**What to build:** Add a `diagram` mark kind to `draw` (Mermaid source plus an optional title, placed as a card on the board) so nothing the old tool did is lost. Then remove the one-shot `draw_diagram` tool (`tools/draw-diagram.ts`), its `showDiagram` context hook and `diagram` event (`src/core/tool-calls.ts:142`), and the separate panel (`app/src/diagram-view.ts`, `app/src/diagram.ts`). The card reuses today's Mermaid loading (bundled, `securityLevel: "strict"`, parse errors shown in the card).

**Blocked by:** 32 Sketch canvas renderer with pen animation

**Status:** done

**Priority:** after-talk

- [x] `draw` accepts a `diagram` mark; it is Zod-checked (non-empty source) and emitted in `canvas.beat`
- [x] The Canvas tab renders the diagram card with Mermaid; bad source shows the parse error in the card
- [x] `draw_diagram`, `showDiagram`, the `diagram` event and the old panel are gone, and the tool list and README match
- [x] `test/diagram.test.ts` is replaced by canvas tests covering the diagram card

## Comments

- 2026-11-15: The card rendering and the parse error were checked in headless Chromium (Vite dev + a fake core), not in the Tauri app.
