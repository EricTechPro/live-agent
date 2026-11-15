# 33: Canvas edit and erase by id

**What to build:** Later turns change the canvas by mark id: "make p2 red", "move p3 under p1", "erase p3", "clear the board". `draw` (or a sibling tool) takes `edit` (id plus colour, label or position) and `erase` (ids, or all). The core keeps the canvas's marks per chat so it can check ids, and emits `canvas.edit` and `canvas.erase`. The window animates the change (erase strokes out).

**Blocked by:** 32 Sketch canvas renderer with pen animation

**Status:** ready-for-agent

**Priority:** after-talk

- [ ] An edit on a known id emits `canvas.edit` with the change (scripted fake model test)
- [ ] An erase emits `canvas.erase`; erase all clears the board
- [ ] An unknown id fails the call with a message the model hears, and no event is emitted
- [ ] The model can see the current mark ids (in the tool result) so it can refer to them
- [ ] The window reducer applies edits and erases; a test covers both

## Comments
