# 27: Safety mode pill in the chat composer

**What to build:** The Ask me / Auto edits / Bypass switch moves from the bottom bar dropdown into the chat composer: a small pill at the left of the input, like ChatGPT's composer picker. Click it to open a small menu of the three modes. Shift+Tab still cycles. The pill shows the mode only from the core's `mode.changed` event, as the bottom bar does today (`app/src/bottom-bar.ts`). The bottom bar dropdown goes away.

**Blocked by:** 22 Two layers: home orb and the control center shell

**Status:** done

**Priority:** must-have

- [x] The composer shows the current mode as a pill left of the input
- [x] Picking a mode in the pill menu changes it in the core; the pill updates from `mode.changed`
- [x] Shift+Tab still cycles the mode and the pill follows
- [x] The pill menu works by keyboard (open, arrows, Enter, Escape)
- [x] The bottom bar no longer has a mode dropdown
- [x] Existing mode-switch tests still pass (`test/mode-switch.test.ts`)

## Comments

- 2026-11-15: built. `app/src/mode-pill.ts` draws the pill and its listbox menu (opens upward, outside the composer's pixel frame); `app/src/mode-menu.ts` is the pure keyboard/click reducer (`test/mode-pill.test.ts`). The pill shows the mode only from `mode.changed` through `bottom-bar.ts`; Shift+Tab moved here from `board-view.ts`, which now draws only the notes used (and nothing when none). Escape inside the open menu closes only the menu, not the control center. Checked against a fake core in a headless browser: click pick, Shift+Tab and arrow keys all change the mode in the core and the pill follows.
