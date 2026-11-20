# 45: the hold-to-draw key is a setting

**What to build:** Hold Ctrl+Option to talk and circle was fixed in Rust. It is now `drawHotkey` in the config and a "Draw key" row in the Agents tab, checked against Jett's own shortcuts.

**Blocked by:** none

**Status:** ready-for-human

**Priority:** after-talk

- [x] `src/config/hotkey.ts`: two modifiers or more plus at most one letter or digit; refuses quick type (⌃⌥T) and show / hide (⌃⌥S); the schema field `drawHotkey`, default `ctrl+option`; `checkConfig` and the setup save refuse a clash
- [x] Agents tab (`app/src/hotkey-settings-view.ts`): Change, hold the new keys, let go; Reset; the reason shown when refused
- [x] Rust (`app/src-tauri/src/lib.rs`): `set_draw_hotkey`; the poll matches exactly those modifiers and the key (`CGEventSourceKeyState`, no permission)
- [x] Tests: `test/draw-hotkey.test.ts`, `test/config.test.ts`
- [ ] Owner: set it to ⌥⌘ on the real Mac, hold it and circle; set it back
