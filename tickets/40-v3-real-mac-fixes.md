# 40: v3 fixes from the real Mac: stuck Offline, orb follows the cursor, Jett's own icon, quick typing

**What to build:** Four things the owner hit using v3 on his own Mac.

1. **Stuck "Offline" after the network went away.** The last line in `~/Desktop/live-agent/logs/core.log` before the window said Offline: `live-agent: could not start: getaddrinfo ENOTFOUND generativelanguage.googleapis.com` (the Mac slept, Wi-Fi dropped). The core exited and stayed dead; only the shell ran, so the window said "Offline" until a manual relaunch. It has to come back by itself, with no user action, at every layer: the core never exits for a network failure and retries with backoff, the shell restarts a core that dies anyway, and the window shows a calm "Reconnecting…" instead of an alarming dead state. The same log shows Gemini Live closing every ~2 min with `1008 Session closed due to client inactivity` and bursts of `Requested entity already exists` / `session not found or expired`: check the reconnect logic for races.
2. **The orb follows the cursor when it should not.** Owner: "why does it follow my cursor when I have this open".
3. **Jett's own icon.** The app and the menu bar still use the template icon. Make the teal pixel LED orb with the wave on a dark rounded square, drawn by our own script, plus a monochrome menu-bar template icon.
4. **Typing without opening the popover.** Typing only works in the popover's Chat tab, which the owner did not find. A small glass text field right under the orb (or next to the edge pill).

**Blocked by:** 39 edge pill minimise

**Status:** ready-for-human

**Priority:** must-have

### 1. Reconnect by itself

- [x] Core: a network or DNS failure on start or on reconnect never exits the process; the Gemini Live adapter keeps dialing with backoff 1 s, 2 s, 5 s, 10 s, then every 30 s, and the core emits `connection` events (`reconnecting` with the attempt and the next retry, then `connected`); pure tested `isNetworkError` and `networkRetryDelay`
- [x] Core: a typed turn while reconnecting ends at once with a plain reason instead of hanging; `POST /reconnect` tries again now (the window's Retry)
- [x] Core: `main.ts` retries the whole start with the same backoff if a network error still escapes, instead of `process.exit(1)`
- [x] Shell: if the core process dies anyway, `lib.rs` starts it again by itself with backoff (1 s, 2 s, 5 s, 10 s, 30 s x3; a run of a minute or more resets the count), tells the window (`core-restarting`, `core-ready`), and only says `core-down` when the restarts run out; `restart_core` is the window's Retry; Rust unit tests for the backoff
- [x] Window: "Reconnecting…" (zh: 重新连接中…) with a calm dimmed teal orb, a slow soft pulse and a small arc turning on the rim, a flat wave in the orb's own teal, and a faint "retrying in 5s" line; the label in the same small style as other states; no red
- [x] Window: only when retries run out (the shell gave up, or the network has been gone for many tries): a muted amber rim and "Can't reach Gemini · Retry" with Retry a small text button; it still retries by itself underneath
- [x] Window: after the shell restarts the core, the window reconnects to the new core by itself
- [x] The stray white capsule above the orb (the drag grip, always drawn) shows only under the cursor, while dragging or with keyboard focus
- [x] Reconnect races checked; findings noted below; clear bugs fixed with tests
- [x] Before / after screenshots: `_tmp/2026-11-15-live-agent-vs-roamies/jett-offline-*.png`

### 2. The orb must not follow the cursor

- [x] Find the real cause in code and note it below
- [x] A drag always ends: on pointer up, on lost pointer capture, when the Rust poll reads the left mouse button up (`overlay_poll` reports it), on window blur, on Esc, and after a few seconds with no movement; pure tested function
- [x] Follow my pointer stays off by default, and while it is on a small indicator on the orb says so (click it to stop)

### 3. App icon and menu-bar icon

- [x] A script draws Jett's icon (the teal pixel LED orb with the wave on a dark rounded square, macOS icon style) to a 1024 px PNG; no outside assets, nothing from Roamies
- [x] `bunx tauri icon` makes every size into `app/src-tauri/icons/`; `tauri.conf.json` lists them
- [x] A monochrome transparent menu-bar template icon (18 pt, 36 px @2x) used as the tray icon with `iconAsTemplate`, so it follows light and dark menu bars
- [x] Crisp and recognisable at 16 px; previews in `_tmp/2026-11-15-live-agent-vs-roamies/jett-icon-*.png`

### 4. Quick typing

- [x] A small glass text field under the orb (beside the pill when minimised) opens from a keyboard button among the orb's hover buttons (tooltip "Type (⌃⌥T)"), the global ⌃⌥T, or starting to type while Jett has focus
- [x] Enter sends a text turn (with or without a call; the reply shows in the bubble, spoken only in a call), Shift+Enter is a new line, Esc closes
- [x] While open the field is a hit region and the window takes keyboard focus; closing gives focus back
- [x] Placeholder "Type to Jett…" / "输入给 Jett…"; a line on the Shortcuts card; the open / close / send logic is a pure tested function

- [ ] Hand check in the real app: turn Wi-Fi off for a minute and on again (Reconnecting… then back, no relaunch), kill the core process (it comes back), drag the orb and let go over another app (it stops), the Dock / Finder icon and the menu-bar icon on light and dark menu bars, ⌃⌥T and type a question

## Comments

- 2026-11-15: built (agent), branch `jett-v3-fixes`.
  - **1, root cause:** `startApp` dialed Gemini Live once at start (`live = await dial()` in `src/models/gemini-live.ts`); a DNS failure threw out of `connect()`, `src/main.ts` printed "could not start" and `process.exit(1)`, and `lib.rs` only reported `core-down`, never restarted. Now: `isNetworkError` + `networkRetryDelay` (1, 2, 5, 10, then 30 s forever) in the adapter, `reconnecting` / `connected` model events become `connection` agent events, a typed turn while offline ends at once, `POST /reconnect` cuts the wait short; `main.ts` retries the whole start on a network error; `lib.rs` restarts a dead core (`restart_delay`, `next_restart`, `schedule_restart`, `restart_core`, Rust unit tests) and emits `core-restarting` / `core-ready`; the window reloads onto a restarted core. Window: `reconnecting` orb state and look (`orb-state.ts`, `call-state.ts` `retryHint`, `orb-wave.ts` soft line / glow / arc, `led-orb.ts`), amber "Can't reach Gemini · Retry" after `RECONNECT_TRIES` (6) network tries or when the shell gives up. Tests: `test/network-retry.test.ts`, `test/reconnecting-view.test.ts`.
  - **1, reconnect races (from core.log):** no true double connect: `reconnect()` is guarded by one shared promise. Found and fixed: (a) `1008 Session closed due to client inactivity` (no call, nothing sent) was treated as a drop: an error event plus an immediate reconnect, every ~2 min forever; now an idle close reconnects lazily on the next text or mic audio, silently. (b) A close saying the resume handle is stale (`session not found or expired`, `Requested entity already exists`) kept the handle when the dial itself had succeeded, so each retry resumed the same dead session: the burst. The handle is dropped on those reasons. (c) A dial still in flight when `close()` ran (New chat during a reconnect) left a live socket nobody owned (a ghost session that can collide with the next resume); it is hung up now. (d) After a give-up, mic audio never triggered a reconnect (only text did); it does now.
  - **2, root cause:** a stuck drag, not the Follow setting (that is off by default, `jett.follow`). A drag ended only on the element's `pointerup` / `pointercancel`. When WebKit never delivers the pointer up (released over another app while click-through flips, focus moves; no `lostpointercapture` handler), `drag` stays set; the poll then keeps the full-screen window taking the mouse (`capture({ hold: !!drag })`) while pointer capture routes every move to the orb, so the orb tracks the cursor until the next click. Fixed with `dragEnd` in `app/src/overlay.ts` (button up read by the poll: `overlay_poll` now reports `mouseDown` from `CGEventSourceButtonState`, the CoreGraphics twin of `NSEvent.pressedMouseButtons`, so no Objective-C crate for it; blur; Esc; 4 s still with no poll), plus `lostpointercapture` and `buttons === 0` on move. Follow, when on, shows a small badge on the orb that stops it. Test: `test/drag-end.test.ts`.
  - **3:** `app/scripts/make-icon.ts` draws the 1024 px icon and the 18 / 36 px template with its own tiny PNG encoder; `bunx tauri icon` made the sizes (the mobile and Windows-store extras it also writes were removed). Tray: `tray-template@2x.png` via `Image::from_bytes` (Tauri feature `image-png`) with `icon_as_template(true)`. Previews: `_tmp/2026-11-15-live-agent-vs-roamies/jett-icon-app.png`, `jett-icon-tray.png`.
  - **4:** `app/src/quick-type.ts` (`nextQuick`, `isQuickTypeStart`, `quickPlace`), the keyboard button (`keyboard` pixel icon), global ⌃⌥T in `lib.rs`, `quick_type_focus` takes the keyboard and hands it back to the app that was in front (`objc2-app-kit` NSWorkspace / NSRunningApplication). Assumption: Enter sends and closes the field (focus goes back to your app); clicking into another app closes it without stealing focus back. Test: `test/quick-type.test.ts`. Screenshot: `jett-quick-type.png`.
  - Screenshots of the offline state: `jett-offline-before-*.png` (the owner's look: salmon rim, white bar, stray grip), `jett-offline-after-reconnecting-*.png`, `jett-offline-after-cant-reach-*.png`.
  - Risks for the hand check: whether `set_focus` makes the accessory overlay window key reliably for the quick field; the window reloads after a core restart (state in the page is lost; the chat itself lives in the core); ⌃⌥T held longer than 250 ms before the T starts push to talk, same as ⌃⌥S.
