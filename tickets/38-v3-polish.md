# 38: v3 polish: an honest wave, minimise to a dot, drag anywhere, shortcuts you can find

**What to build:** The owner tried v3 on his Mac and likes it. Polish from that real use. The wave inside the orb only moves when something really happens: flat at rest, your voice while listening, Jett's voice while speaking, a slow sweep while thinking. A way to get Jett out of the way without quitting: a hide (minus) button on hover, double-click the orb, or Ctrl+Option+S shrinks it to a small faint dot; the dot brings it back. Both the orb and the dot drag anywhere on the screen. The shortcuts are discoverable: a hint under "Tap to talk", every tooltip names its key, and a small Shortcuts card. Plus the real-screen bugs from the install check: the first click is swallowed and hover never shows while another app is in front, and letting go of Ctrl+Option before the call connects leaves the mic open.

**Blocked by:** 36 Floating overlay, 37 Phone-call controls

**Status:** ready-for-human

**Priority:** must-have

- [x] The wave follows real activity, from a pure tested function (look plus levels in, wave out): flat at rest, ended and offline; flat, dimmed and the mic-slash while muted; the live mic level while listening (flat when you are quiet); Jett's output level while speaking (a gentle speech-like motion if there is none); a slow sweeping dot while thinking or connecting; nothing moves with prefers-reduced-motion
- [x] A minus button shows on hover next to the orb, tooltip "Hide (⌃⌥S)"
- [x] Minus, a double-click on the orb, Ctrl+Option+S or the menu-bar item shrink Jett to a small faint dot at the nearest screen edge; clicking the dot, Ctrl+Option+S or holding Ctrl+Option brings it back; minimised is remembered across launches; the menu-bar item says Hide or Show to match
- [x] The whole orb drags (press and move past a small threshold); a press without movement still starts a call; the click-or-drag rule is a pure tested function
- [x] The dot drags anywhere and stays where it is dropped, snapping to an edge only when dropped within 24 px of it; both spots are remembered across launches
- [x] Under "Tap to talk", a faint "or hold ⌃⌥" (zh: "或按住 ⌃⌥") until push to talk has been used twice; pure tested function
- [x] Every control's tooltip names its shortcut
- [x] A "?" in the popover and a menu-bar "Shortcuts" item open a small glass card: tap orb / Space = talk, hold ⌃⌥ = push to talk, Space in a call = mute, Esc = stop reply, ⌘. = hang up, ⌃⌥S = hide / show, double-click orb = minimise
- [x] The first click on Jett acts even while another app is in front (`acceptFirstMouse`)
- [x] Hover reveal (menu, minus) is driven by the overlay poll's cursor, not DOM hover, so it works while another app is in front; "is the cursor over the orb (plus padding)" is a pure tested function
- [x] Letting go of Ctrl+Option always wins: let go before the call connects and the mic is muted once it does; pure tested function
- [ ] Hand check in the real app: wave at rest and while talking, minimise and restore by every route, drag orb and dot, first click from another app, hover from another app, quick push to talk

## Comments

- 2026-11-15: built (agent). Pure parts: `app/src/orb-wave.ts` (look + levels -> flat / wave / sweep), `isDrag`, `isDoubleClick`, `dropDot`, `dotFor`, `hoverOrb`, `pttPress` / `pttRelease` in `app/src/overlay.ts`, `talkHint` in `app/src/call-state.ts`, `app/src/shortcuts.ts`; tests in `test/orb-wave.test.ts`, `test/overlay-polish.test.ts`, `test/shortcuts.test.ts`. The LED orb takes a `wave` option; with it nothing twinkles or breathes while the wave is flat, and under reduced motion it redraws every 250 ms without moving. Jett's output level comes from a Web Audio analyser on the agent's LiveKit track; until that track has ever been louder than quiet, speaking uses the gentle motion (so a WebKit that can't read remote audio still looks right). A single click on the orb now waits 280 ms so a double-click can minimise. Ctrl+Option+S and the menu-bar item no longer hide the window: they emit `toggle-mini`, and the page tells Rust (`set_tray_shown`) so the item says Hide or Show. Minimised also hides the cues; an approval card brings Jett back. Window config: `acceptFirstMouse: true`, `focus: false`. Screenshots: `_tmp/2026-11-15-live-agent-vs-roamies/jett-v3p-*.png`. Risks for the hand check: tooltips still come from DOM pointer events, so they may not show while another app is in front (the hover reveal does, from the poll); whether WebKit keeps the call's audio unlock when the start runs from the 280 ms click timer.
