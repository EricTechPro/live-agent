# 22: Two layers: home orb and the control center shell

**What to build:** The window gets two layers. Home is a big animated orb (reuse `app/src/led-orb.ts`) with the call controls and one way into the control center, almost nothing else. The control center is a three-column shell like the Codex / ChatGPT desktop apps: left sidebar, middle chat (orb small at the top, today's transcript and composer moved here), right panel. Sidebar and right panel can be empty placeholders here; tickets 23, 24 and 25 fill them. Less text everywhere: Jett should feel like a "Jarvis". See the spec addendum "Two layers".

**Blocked by:** None

**Status:** ready-for-agent

**Priority:** must-have

- [ ] The app opens on home: the big orb, the call controls, and a control center button
- [ ] Opening the control center shows left sidebar, middle chat and right panel; the orb sits small at the top of the chat
- [ ] Closing it (X button or Escape) goes back to home, and the call keeps going
- [ ] The orb shows the same states (listening, thinking, speaking) on both layers
- [ ] Which layer is open is a pure reducer with a test, like `app/src/diagram.ts`
- [ ] Hand check in the real app: talking works the same on both layers, and the mini orb still works

## Comments
