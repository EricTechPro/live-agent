# 26: Icon call controls and icon top bar

**What to build:** Replace the text buttons ("Start talking", "Pause", "Send", the top bar chips) with icon buttons, each with a tooltip and an `aria-label`, no text labels. Call controls: **Start call** (mic / phone icon), **Pause** that toggles to **Resume**, **End call** (red hang-up). **Close (X)** for panels and the control center. The top bar's New chat, Setup, Show log, Mini and Jobs become icon buttons too; Jobs keeps its count as a badge. Inline SVG icons, no icon font or CDN.

**Blocked by:** 22 Two layers: home orb and the control center shell

**Status:** done

**Priority:** must-have

- [x] Start call, Pause / Resume and End call are icons only, with tooltips; End call is red
- [x] Pause shows a Resume icon while paused (`aria-pressed` stays right); Space still toggles it
- [x] New chat, Setup, Show log, Mini and Jobs are icon buttons with tooltips; Jobs shows its running count
- [x] Every icon button has an `aria-label`, a visible focus ring, and works with Enter and Space
- [x] Tooltips name the shortcut where there is one
- [ ] Hand check in the real app: a full call (start, pause, resume, end) with mouse only and with keyboard only

## Comments

- 2026-11-15: built. Icons are 12x12 pixel bitmaps drawn as inline SVG (`app/src/icons.ts`), so they match the LED orb. One shared tooltip (`app/src/tooltip.ts`) shows on hover and keyboard focus, with the shortcut key (Space, Esc, Enter). Start call is one button that turns into the red End call in a call; Pause keeps its name with `aria-pressed` and shows a Resume icon and tip while paused. The composer's Send is an arrow icon inside the input box. Tests: `test/icons-tooltip.test.ts`. The full call by mouse and by keyboard in the real app is left for a person.
