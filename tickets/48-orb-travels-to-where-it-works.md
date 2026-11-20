# 48: the orb travels to where it works and narrates the step

**What to build:** Gap scan #1 (Roamies idea, our own code). While `act_in_app` works, the orb, its bubble and a "◌ Working in CapCut" pill fly to the control it is about to click, the bubble says the step about 1.5 s before it acts, the pill ends on ✓, then the orb goes home.

**Blocked by:** 41 image cards

**Status:** ready-for-human

**Priority:** must-have

- [x] `act_in_app` steps take an optional `say` (schema, description, prompt rule in `src/core/tone.ts`)
- [x] Each step emits `act.step` (`src/core/events.ts`): `start` with the found control's rect and `say`, then `done` or `failed`; a typing step keeps the last rect; the lead (`actTiming.leadMs` 1600) only when there is a say, a short travel wait otherwise, a 400 ms hold after the last
- [x] Esc (`stopReply`) aborts a running call's `signal`: act_in_app stops between steps ("stopped by the user")
- [x] Window (`app/src/travel.ts`, `main.ts`): the dock moves GAP right of the control (bubble further right), or to its left when there is no room, a 160 ms ease; home again on the call's `tool.result`
- [x] While act_in_app runs the overlay never takes the mouse, so Jett's own clicks land
- [x] Tests: `test/orb-actions.test.ts` (stream), `test/orb-travel.test.ts` (placement)
- [ ] Owner: "scale this clip up to 200%" in CapCut on the real Mac; check the orb never covers the field
