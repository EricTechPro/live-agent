# 36: Floating overlay: full-screen, transparent, click-through

**What to build:** Replace the big v2 window with a Roamies-like overlay (ideas only, AGPL). One full-screen transparent window on the main screen, always on top, frameless, no shadow, click-through except over the interactive bits. At rest only the orb (small, draggable by a grip, remembers its spot) and its cues. The sketch canvas draws straight on the screen in a glass card. Chats, brain files, jobs and settings live in one compact glass popover opened from a menu button by the orb, one view at a time. Approvals are a small glass card by the orb. No Dock icon: a menu-bar icon. See the spec addendum "Jett v3: floating overlay".

**Blocked by:** 22 Home orb and control center shell, 25 Right panel with Canvas and Jobs tabs

**Status:** ready-for-human

**Priority:** must-have

- [x] One transparent, frameless, shadowless, always-on-top window covers the main screen; only the orb, cues and glass pieces show
- [x] Clicks go through the window everywhere except the orb, its buttons, the popover, approval cards and the canvas X; the hit test is pure code with tests
- [x] The orb drags by its grip, remembers its spot across launches and is kept on screen; "Follow my pointer" is an option (off by default)
- [x] Live captions: your words stream as you speak, then Jett's, fading out; the bottom caption bar takes them while a drawing is on screen; a pure reducer with tests
- [x] The sketch draws straight on the screen in a terminal-style glass card with an X, in the empty half of the screen; strokes readable over a busy background
- [x] A menu button by the orb opens one glass popover with icon tabs (Chat, Jobs, Brain) and Follow, New chat, Setup, Show log; Esc or X closes it
- [x] Approval cards show next to the orb; approving or denying works as before
- [x] No Dock icon; a menu-bar icon opens the popover, and its menu shows / hides Jett or quits
- [x] Every v2 feature still works: mode pill, job cards, the brain reader, past chats, canvas edits, new chat, setup, show log
- [ ] Hand check in the real app: transparency, click-through, dragging, always on top, menu-bar icon, voice

## Comments

- 2026-11-15: built (agent). One window covers the main screen's work area (`cover_main_screen` in `app/src-tauri/src/lib.rs`) and starts click-through, so a page that fails to load never blocks the desktop. The page polls `overlay_poll` (Rust) every 50 ms for the cursor and turns click-through off over any `[data-hit]` element (`capture` in `app/src/overlay.ts`). Popover, cues and drawing card are placed beside / away from the orb by pure functions in the same file. Mini orb (ticket 15) and `set_mini` are gone. Checked in headless Chromium against a fake core, the app in a transparent iframe over a busy fake desktop: `_tmp/2026-11-15-live-agent-vs-roamies/jett-v3-*.png`. Not checked: anything only the real macOS window does (transparency, click-through, the cursor coordinates from `cursor_position`, the tray, the accessory app policy).
