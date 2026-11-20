# 53: small touches from the gap scan

**What to build:** The report's smaller touches: thinking dots on the pill, a ✓ done state on status pills, Esc stops a reply from anywhere, and "Here's what I can do / Try me out" at the end of setup.

**Blocked by:** 41 image cards

**Status:** ready-for-human

**Priority:** after-talk

- [x] Pill: a seven-dot marquee while thinking; ✓ (or ✗) with the action's words for 900 ms after a call (`app/src/cues.ts`, `actions.css`); labels for the new tools
- [x] Esc: the overlay poll reports Esc (`CGEventSourceKeyState`, `lib.rs`) so it stops a reply, an act or a guide while another app has the keyboard
- [x] Setup's last step lists what Jett can do with a line to say for each; Try me out closes setup and sends a first turn that draws
- [ ] Owner: check Esc from another app works without Input Monitoring; look at the pill and the last setup step on the real Mac
