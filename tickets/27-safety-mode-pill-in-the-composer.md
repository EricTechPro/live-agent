# 27: Safety mode pill in the chat composer

**What to build:** The Ask me / Auto edits / Bypass switch moves from the bottom bar dropdown into the chat composer: a small pill at the left of the input, like ChatGPT's composer picker. Click it to open a small menu of the three modes. Shift+Tab still cycles. The pill shows the mode only from the core's `mode.changed` event, as the bottom bar does today (`app/src/bottom-bar.ts`). The bottom bar dropdown goes away.

**Blocked by:** 22 Two layers: home orb and the control center shell

**Status:** ready-for-agent

**Priority:** must-have

- [ ] The composer shows the current mode as a pill left of the input
- [ ] Picking a mode in the pill menu changes it in the core; the pill updates from `mode.changed`
- [ ] Shift+Tab still cycles the mode and the pill follows
- [ ] The pill menu works by keyboard (open, arrows, Enter, Escape)
- [ ] The bottom bar no longer has a mode dropdown
- [ ] Existing mode-switch tests still pass (`test/mode-switch.test.ts`)

## Comments
