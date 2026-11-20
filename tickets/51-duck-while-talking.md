# 51: quiet Mac while you talk

**What to build:** Gap scan #8. Config `duckWhileTalking` (default on): other sounds go quiet while push to talk is held, back to the exact level after.

**Blocked by:** 41 image cards

**Status:** ready-for-human

**Priority:** after-talk

- [x] `src/duck.ts`: the system output volume via AppleScript, to 15% while held; the level before is written to `<home>/.duck.json` first, restored on let go, on close, and on the next start after a crash
- [x] `POST /duck`, called from push to talk in the window; `session.duck` honours the config
- [x] Tests in `test/orb-actions.test.ts`
- [ ] Owner: play music, hold ⌃⌥, let go; quit mid-hold and start again
