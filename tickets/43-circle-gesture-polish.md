# 43: circle gesture polish and the answer on the circled spot

**What to build:** The circle ink was a raw teal polyline that glowed on close and faded before Jett answered somewhere else. Now it is a smooth mint line that reads on white pages, the listening pill rides the pointer while drawing, and the answer comes from a ghost orb on the circled spot. Feel from ScreenBrush and Roamies: ideas only, no code.

**Blocked by:** 42 pixel photos and 3D models

**Status:** ready-for-human

**Priority:** after-talk

- [x] Stroke (`app/src/ink-stroke.ts`, `app/src/screen-ink.ts`): Chaikin smoothing, mint `#6ff0dc` 4.5 pt over a 1 pt darker teal edge `#1f9f90`, round caps, no glow; it stays while the keys are held and fades over 0.5 s on release
- [x] Listening pill at the pointer while drawing: 36 x 14, 8 pt up and right of the tip, seven bars bouncing with the mic level
- [x] Ghost orb: when Jett answers a circle (within 25 s of it closing), a see-through dot sphere forms on the circle's centre with the reply typing in a bubble beside it (right, or left near the right edge); it goes 3.5 s after the turn ends, or at the next hold
- [x] Jett v2: the ghost orb is gone; the real orb travels beside the circled box (app/src/travel.ts `addCircleEvent`, the act_in_app travel path) with its answer bubble, and goes home 3.5 s after the turn ends, or at the next hold
- [x] Tests: `test/ink-stroke.test.ts`
- [ ] Owner: circle something on a white page and on a dark one, ask "what's this?", check the line, the pill and where the answer lands
