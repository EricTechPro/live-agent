# 52: guide: "show me how", step by step

**What to build:** Gap scan #6. `guide` rings the real control, says the step, waits for the user's own click on it, then the next; Esc or "stop" ends it.

**Blocked by:** 48 orb travels

**Status:** ready-for-human

**Priority:** must-have

- [x] `tools/guide.ts`: find each target (locator), a `spot` ring mark, `act.step` waiting / done, an early answer per step (`ToolContext.tell`, willContinue) so the voice says it then, a click within 24 pt of it (eyes `watch`) moves on; 2 min with no click asks to carry on
- [x] Esc (abort signal) and `guide { stop: true }` end it; a target not found draws nothing
- [x] The orb sits beside the ringed control while it waits
- [x] Tests in `test/orb-actions.test.ts`
- [ ] Owner: "show me how to export this" in a real app; typed turns are refused while a guide waits (voice works)
