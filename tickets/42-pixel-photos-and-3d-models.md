# 42: pixel photos and turning 3D models

**What to build:** A found or generated picture showed as a plain full-colour photo, which broke the LED look, and Jett had no way to show the shape of a thing in 3D. Pictures are now re-drawn as teal dots, and a new `model` card turns a built-in 3D shape in the same dots. Idea from Roamies (AGPL): ideas only, no code.

**Blocked by:** 41 image cards

**Status:** ready-for-human

**Priority:** after-talk

- [x] Dither (`app/src/dither.ts`, painter `app/src/dither-paint.ts`): luminance stretched to the full range (a light background is flipped so the paper drops out), a 5-level teal ramp from the tokens (`--edge` … `--ink`), ordered Bayer 4x4, 3 px cells, dark cells dropped, a soft glow on the bright dots
- [x] Image cards (`app/src/card-view.ts`): the dots fade in from a sparse quarter to full with the glow over 0.9 s; a click on the card shows the original photo and back; find and generate both
- [x] `model` card kind (`src/core/card-kinds.ts`, Zod in `src/core/canvas.ts`, `tools/draw.ts`): shape sphere, planet, torus, cube, cell, molecule (atoms + bonds), points, heightmap (square grid); up to 4 labels pinned at x, y, z; coordinates clamped to -1..1
- [x] Renderer (`app/src/model3d.ts`): a tiny ray-marcher over distance fields, one ray per dot, Lambert light from the upper left; builds up from dots in 0.75 s, turns at 15°/s with a slight wobble, 24 fps; labels bold white mono with a dark edge; no 3D dependency
- [x] Prompt rule in `src/core/tone.ts`: kind model for the shape of a thing in 3D
- [x] Tests: `test/dither.test.ts`, `test/model3d.test.ts`, `test/model-card.test.ts` (event stream), `test/layout.test.ts`; demo `demo-draw.html?scene=pixels`
- [ ] Owner: ask Jett for "a picture of a black hole" and "show me a water molecule in 3D" on the real Mac
