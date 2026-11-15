# 25: Right panel with Canvas and Jobs tabs

**What to build:** The control center's right panel has two tabs: **Canvas** and **Jobs**. Jobs holds the existing job board (`app/src/board-view.ts`). Canvas holds today's diagram panel (`app/src/diagram-view.ts`) until the sketch canvas (ticket 32) replaces it. A new diagram switches to Canvas; a new job doesn't steal focus but shows a badge on the Jobs tab. The panel closes with X.

**Blocked by:** 22 Two layers: home orb and the control center shell

**Status:** done

**Priority:** must-have

- [x] The right panel shows Canvas and Jobs tabs, keyboard reachable (arrow keys between tabs)
- [x] A `diagram` event opens the Canvas tab with the diagram
- [x] A job starting shows a running count badge on the Jobs tab without switching tabs
- [x] X closes the panel; the Jobs icon in the top bar opens it on the Jobs tab
- [x] Tab state is a pure reducer with a test

## Comments

- 2026-11-15: built. `app/src/panel.ts` is the reducer (`test/panel.test.ts`): `diagram` and any `canvas.*` event open the Canvas tab (and the control center, from home); a job starting only bumps the running badge on the Jobs tab and the top bar's Jobs icon. The job drawer is gone; the board lives in the Jobs tab. The Canvas tab holds today's diagram panel (its own close button removed, the panel's X does it) with an empty state ("Jett draws here.") until the sketch canvas (ticket 32) mounts in `#panel-canvas`. Checked against a fake core in a headless browser: Jobs icon, X, Escape, a diagram event and arrow keys between tabs.
