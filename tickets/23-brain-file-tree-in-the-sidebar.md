# 23: Brain file tree in the sidebar, click a file to read it

**What to build:** The control center's left sidebar shows the second brain as a file tree: `raw`, `wiki` and `projects`, using the configured `brainFolders` names. Clicking a markdown file opens it read-only in the middle column (close with X to get back to the chat). The core serves the tree and the file through new read-only endpoints that never leave the brain folder and skip the same junk folders the brain search skips.

**Blocked by:** 22 Two layers: home orb and the control center shell

**Status:** ready-for-agent

**Priority:** must-have

- [ ] The sidebar lists the three brain folders and their files, folders collapsible
- [ ] Clicking a file shows its text read-only; X returns to the chat
- [ ] A path outside the brain folder (`..`, absolute, symlink out) is refused by the core
- [ ] A file saved by `remember` or the chat-end note shows up in the tree without a restart
- [ ] Core endpoint tests cover the tree, a file read and the refused paths

## Comments
