# 36: Floating overlay: full-screen, transparent, click-through

**What to build:** Replace the big v2 window with a Roamies-like overlay (ideas only, AGPL). One full-screen transparent window on the main screen, always on top, frameless, no shadow, click-through except over the interactive bits. At rest only the orb (small, draggable by a grip, remembers its spot) and live captions at the bottom centre. The sketch canvas draws straight on the screen. Chats, brain files, jobs and settings live in one compact glass popover opened from a menu button by the orb, one view at a time. Approvals are a small glass card by the orb. See the spec addendum "Jett v3: floating overlay".

**Blocked by:** 22 Home orb and control center shell, 25 Right panel with Canvas and Jobs tabs

**Status:** ready-for-agent

**Priority:** must-have

- [ ] One transparent, frameless, shadowless, always-on-top window covers the main screen; only the orb, captions and glass pieces show
- [ ] Clicks go through the window everywhere except the orb, its buttons, the popover, approval cards and the canvas X; the hit test is pure code with tests
- [ ] The orb drags by its grip, remembers its spot across launches and is kept on screen
- [ ] Live captions at the bottom centre: your words stream as you speak, then Jett's, two short lines at most, styled differently, fading out; a pure reducer with tests
- [ ] The sketch canvas draws straight on the screen, see-through, strokes readable over a busy background; a new chat or its X clears it
- [ ] A menu button by the orb opens one glass popover with icon tabs (Chat, Jobs, Brain) and New chat, Setup, Show log; Esc or X closes it
- [ ] Approval cards show next to the orb; approving or denying works as before
- [ ] Every v2 feature still works: mode pill, job cards, the brain reader, past chats, canvas edits, new chat, setup, show log
- [ ] Hand check in the real app: transparency, click-through, dragging, always on top, voice

## Comments
