# 23: Brain file tree in the sidebar, click a file to read it

**What to build:** The control center's left sidebar shows the second brain as a file tree: `raw`, `wiki` and `projects`, using the configured `brainFolders` names. Clicking a markdown file opens it read-only in the middle column (close with X to get back to the chat). The core serves the tree and the file through new read-only endpoints that never leave the brain folder and skip the same junk folders the brain search skips.

**Blocked by:** 22 Two layers: home orb and the control center shell

**Status:** done

**Priority:** must-have

- [x] The sidebar lists the three brain folders and their files, folders collapsible
- [x] Clicking a file shows its text read-only; X returns to the chat
- [x] A path outside the brain folder (`..`, absolute, symlink out) is refused by the core
- [x] A file saved by `remember` or the chat-end note shows up in the tree without a restart
- [x] Core endpoint tests cover the tree, a file read and the refused paths

## Comments

- 2026-11-15 (sidebar builder): core routes `GET /brain/tree` and `GET /brain/file?path=` (`src/brain/tree.ts`, `src/app.ts`), launch token like every route. Markdown only, inside the three part folders; `..`, absolute paths, dot / junk folders (`JUNK_FOLDERS`, exported from `src/brain/index.ts`) and symlinks out (real path checked) answer 400. The window refetches the tree on `brain.write`, `chat.started` and `setup.saved`. Tests: `test/brain-routes.test.ts`, `test/brain-tree-view.test.ts`. Not yet hand-checked in the Tauri app.
