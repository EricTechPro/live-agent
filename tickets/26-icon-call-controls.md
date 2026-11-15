# 26: Icon call controls and icon top bar

**What to build:** Replace the text buttons ("Start talking", "Pause", "Send", the top bar chips) with icon buttons, each with a tooltip and an `aria-label`, no text labels. Call controls: **Start call** (mic / phone icon), **Pause** that toggles to **Resume**, **End call** (red hang-up). **Close (X)** for panels and the control center. The top bar's New chat, Setup, Show log, Mini and Jobs become icon buttons too; Jobs keeps its count as a badge. Inline SVG icons, no icon font or CDN.

**Blocked by:** 22 Two layers: home orb and the control center shell

**Status:** ready-for-agent

**Priority:** must-have

- [ ] Start call, Pause / Resume and End call are icons only, with tooltips; End call is red
- [ ] Pause shows a Resume icon while paused (`aria-pressed` stays right); Space still toggles it
- [ ] New chat, Setup, Show log, Mini and Jobs are icon buttons with tooltips; Jobs shows its running count
- [ ] Every icon button has an `aria-label`, a visible focus ring, and works with Enter and Space
- [ ] Tooltips name the shortcut where there is one
- [ ] Hand check in the real app: a full call (start, pause, resume, end) with mouse only and with keyboard only

## Comments
