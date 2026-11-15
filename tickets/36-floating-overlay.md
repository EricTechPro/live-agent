# 36: Floating overlay: small, transparent, always on top

**What to build:** Replace the big v2 window with a small floating overlay, like Roamies (ideas only, AGPL). The window is frameless, transparent and always on top, with a grip handle to drag it. Home is just the orb, its bubble and call controls that show on hover or in a call. The control center is one compact translucent glass panel that grows out of the orb, with icon tabs for Chat, Canvas, Jobs and Brain, one view at a time. The window grows to fit the panel and shrinks back when it closes, and remembers where you put it. See the spec addendum "Jett v3: floating overlay".

**Blocked by:** 22 Home orb and control center shell, 25 Right panel with Canvas and Jobs tabs

**Status:** ready-for-agent

**Priority:** must-have

- [ ] The window is frameless, transparent (no background, no shadow) and always on top; only the orb and glass pieces show
- [ ] Home is about 280 x 340: the orb, the speech bubble, a grip handle that drags the window, and a running-jobs badge
- [ ] Call controls (call / hang up, pause, control center) are small icon buttons that show on hover and focus, and stay in a call or paused
- [ ] Clicking the orb opens the control center: one glass panel (dark tint, blur, rounded, thin teal border), the window grows to about 420 x 640, the grip stays put
- [ ] Icon tabs with tooltips switch between Chat, Canvas, Jobs and Brain, one view at a time; arrow keys move between them
- [ ] X or Esc closes the control center and the window shrinks back to home; the call keeps going
- [ ] Every v2 feature still works: approval cards, mode pill, job cards, the brain reader, past chats, canvas edits, new chat, setup, show log
- [ ] The canvas board is see-through and pen strokes stay readable over a busy background
- [ ] The window remembers its position across launches and is kept on screen
- [ ] Sizes, anchoring and position restore are pure code with tests; the view reducer has tests
- [ ] Hand check in the real app: transparency, dragging by the grip, grow and shrink, always on top, voice on both layers

## Comments
