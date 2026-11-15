# 24: Past chats in the sidebar

**What to build:** The left sidebar lists past chats above the file tree, newest first, each with a short title and date. They come from the chat-end notes already saved in `raw`. Clicking one shows that chat's note read-only in the middle. It does not resume the Live session.

**Blocked by:** 22 Two layers: home orb and the control center shell, 23 Brain file tree in the sidebar

**Status:** ready-for-agent

**Priority:** after-talk

- [ ] The sidebar lists past chats from the saved chat-end notes, newest first
- [ ] A chat ending (`chat.started` after its note is saved) adds it to the list
- [ ] Clicking a past chat shows it read-only; X returns to the live chat
- [ ] Core test: after two chats, the chat list endpoint returns both with titles

## Comments
