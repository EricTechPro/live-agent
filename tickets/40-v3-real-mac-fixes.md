# 40: v3 fixes from the real Mac: stuck Offline, orb follows the cursor, Jett's own icon, quick typing

**What to build:** Four things the owner hit using v3 on his own Mac.

1. **Stuck "Offline" after the network went away.** The last line in `~/Desktop/live-agent/logs/core.log` before the window said Offline: `live-agent: could not start: getaddrinfo ENOTFOUND generativelanguage.googleapis.com` (the Mac slept, Wi-Fi dropped). The core exited and stayed dead; only the shell ran, so the window said "Offline" until a manual relaunch. It has to come back by itself, with no user action, at every layer: the core never exits for a network failure and retries with backoff, the shell restarts a core that dies anyway, and the window shows a calm "Reconnecting…" instead of an alarming dead state. The same log shows Gemini Live closing every ~2 min with `1008 Session closed due to client inactivity` and bursts of `Requested entity already exists` / `session not found or expired`: check the reconnect logic for races.
2. **The orb follows the cursor when it should not.** Owner: "why does it follow my cursor when I have this open".
3. **Jett's own icon.** The app and the menu bar still use the template icon. Make the teal pixel LED orb with the wave on a dark rounded square, drawn by our own script, plus a monochrome menu-bar template icon.
4. **Typing without opening the popover.** Typing only works in the popover's Chat tab, which the owner did not find. A small glass text field right under the orb (or next to the edge pill).

**Blocked by:** 39 edge pill minimise

**Status:** ready-for-agent

**Priority:** must-have

### 1. Reconnect by itself

- [ ] Core: a network or DNS failure on start or on reconnect never exits the process; the Gemini Live adapter keeps dialing with backoff 1 s, 2 s, 5 s, 10 s, then every 30 s, and the core emits `connection` events (`reconnecting` with the attempt and the next retry, then `connected`); pure tested `isNetworkError` and `networkRetryDelay`
- [ ] Core: a typed turn while reconnecting ends at once with a plain reason instead of hanging; `POST /reconnect` tries again now (the window's Retry)
- [ ] Core: `main.ts` retries the whole start with the same backoff if a network error still escapes, instead of `process.exit(1)`
- [ ] Shell: if the core process dies anyway, `lib.rs` starts it again by itself with backoff (1 s, 2 s, 5 s, 10 s, 30 s x3; a run of a minute or more resets the count), tells the window (`core-restarting`, `core-ready`), and only says `core-down` when the restarts run out; `restart_core` is the window's Retry; Rust unit tests for the backoff
- [ ] Window: "Reconnecting…" (zh: 重新连接中…) with a calm dimmed teal orb, a slow soft pulse and a small arc turning on the rim, a flat wave in the orb's own teal, and a faint "retrying in 5s" line; the label in the same small style as other states; no red
- [ ] Window: only when retries run out (the shell gave up, or the network has been gone for many tries): a muted amber rim and "Can't reach Gemini · Retry" with Retry a small text button; it still retries by itself underneath
- [ ] Window: after the shell restarts the core, the window reconnects to the new core by itself
- [ ] The stray white capsule above the orb (the drag grip, always drawn) shows only under the cursor, while dragging or with keyboard focus
- [ ] Reconnect races checked; findings noted below; clear bugs fixed with tests
- [ ] Before / after screenshots: `_tmp/2026-11-15-live-agent-vs-roamies/jett-offline-*.png`

### 2. The orb must not follow the cursor

- [ ] Find the real cause in code and note it below
- [ ] A drag always ends: on pointer up, on lost pointer capture, when the Rust poll reads the left mouse button up (`overlay_poll` reports it), on window blur, on Esc, and after a few seconds with no movement; pure tested function
- [ ] Follow my pointer stays off by default, and while it is on a small indicator on the orb says so (click it to stop)

### 3. App icon and menu-bar icon

- [ ] A script draws Jett's icon (the teal pixel LED orb with the wave on a dark rounded square, macOS icon style) to a 1024 px PNG; no outside assets, nothing from Roamies
- [ ] `bunx tauri icon` makes every size into `app/src-tauri/icons/`; `tauri.conf.json` lists them
- [ ] A monochrome transparent menu-bar template icon (18 pt, 36 px @2x) used as the tray icon with `iconAsTemplate`, so it follows light and dark menu bars
- [ ] Crisp and recognisable at 16 px; previews in `_tmp/2026-11-15-live-agent-vs-roamies/jett-icon-*.png`

### 4. Quick typing

- [ ] A small glass text field under the orb (beside the pill when minimised) opens from a keyboard button among the orb's hover buttons (tooltip "Type (⌃⌥T)"), the global ⌃⌥T, or starting to type while Jett has focus
- [ ] Enter sends a text turn (with or without a call; the reply shows in the bubble, spoken only in a call), Shift+Enter is a new line, Esc closes
- [ ] While open the field is a hit region and the window takes keyboard focus; closing gives focus back
- [ ] Placeholder "Type to Jett…" / "输入给 Jett…"; a line on the Shortcuts card; the open / close / send logic is a pure tested function

- [ ] Hand check in the real app: turn Wi-Fi off for a minute and on again (Reconnecting… then back, no relaunch), kill the core process (it comes back), drag the orb and let go over another app (it stops), the Dock / Finder icon and the menu-bar icon on light and dark menu bars, ⌃⌥T and type a question

## Comments
