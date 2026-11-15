# 25: Right panel with Canvas and Jobs tabs

**What to build:** The control center's right panel has two tabs: **Canvas** and **Jobs**. Jobs holds the existing job board (`app/src/board-view.ts`). Canvas holds today's diagram panel (`app/src/diagram-view.ts`) until the sketch canvas (ticket 32) replaces it. A new diagram switches to Canvas; a new job doesn't steal focus but shows a badge on the Jobs tab. The panel closes with X.

**Blocked by:** 22 Two layers: home orb and the control center shell

**Status:** ready-for-agent

**Priority:** must-have

- [ ] The right panel shows Canvas and Jobs tabs, keyboard reachable (arrow keys between tabs)
- [ ] A `diagram` event opens the Canvas tab with the diagram
- [ ] A job starting shows a running count badge on the Jobs tab without switching tabs
- [ ] X closes the panel; the Jobs icon in the top bar opens it on the Jobs tab
- [ ] Tab state is a pure reducer with a test

## Comments
