# 49: reminders and the Reminders card

**What to build:** Gap scan #5. "Nudge me in 3 hours to go to the gym": `remind`, `list_reminders`, `done_reminder`, `snooze_reminder`, stored in the brain folder, fired while Jett is open with a spoken nudge, a chime and the card.

**Blocked by:** 41 image cards

**Status:** ready-for-human

**Priority:** must-have

- [x] `src/reminders.ts`: `<brain>/.reminders.json`; plain-word times ("in 3 hours", "at 5pm", "tomorrow at 9", "friday 10am", ISO); repeats as a cron `every`; snooze; done
- [x] The scheduler's minute tick (`onMinute`, `src/workflows/scheduler.ts`) fires due ones once: `reminders` event with `due` + `show`, and a notice to the model even before anyone spoke
- [x] Tools `remind`, `list_reminders`, `done_reminder`, `snooze_reminder`; each emits `reminders`
- [x] The card (`app/src/reminders-card.ts`): "Today N / Later N", ring checkboxes (tick = POST /reminders/done), time on the right, a dashed divider, × to close
- [x] Tests in `test/orb-actions.test.ts` and `test/orb-travel.test.ts`
- [ ] Owner: "nudge me in 2 minutes to stretch", wait, hear it
