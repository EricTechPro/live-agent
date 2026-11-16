# 24: Past chats in the sidebar

**What to build:** The left sidebar lists past chats above the file tree, newest first, each with a short title and date. They come from the chat-end notes already saved in `raw`. Clicking one shows that chat's note read-only in the middle. It does not resume the Live session.

**Blocked by:** 22 Two layers: home orb and the control center shell, 23 Brain file tree in the sidebar

**Status:** done

**Priority:** after-talk

- [x] The sidebar lists past chats from the saved chat-end notes, newest first
- [x] A chat ending (`chat.started` after its note is saved) adds it to the list
- [x] Clicking a past chat shows it read-only; X returns to the live chat
- [x] Core test: after two chats, the chat list endpoint returns both with titles

## Comments

- 2026-11-15 (chats builder): core route `GET /brain/chats` -> `{ chats: [{ path, title, date }] }` (`src/brain/chats.ts`, `src/app.ts`), launch token like every route. Only `<raw>/YYYY-MM-DD-chat[-n].md` files count (symlinks skipped); order comes from the name (day, then n), the date shown is the file time ("4m", "2h", "1d", "2 Nov"). Title: the note's first line, bullet and `You:` / `Agent:` dropped, cut to 60 characters; the full title is the row's tooltip. A click opens the note in the ticket 23 reader through `GET /brain/file` (same path checks); X or Escape goes back. The window refetches on `chat.started`, a chat-end `brain.write` and `setup.saved`. Tests: `test/past-chats.test.ts`, `test/chat-list-view.test.ts`. Checked in headless Chromium + Vite dev against the real core with a scripted model; not yet hand-checked in the Tauri app.
