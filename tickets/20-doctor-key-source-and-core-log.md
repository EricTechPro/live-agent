# 20: Doctor reads the right key, and the core keeps a log

**What to build:** Two fixes from Eric's first real install. One: the installer's doctor said "key works" because it picked up a `.env` from the folder it was run in, while the app's own key file was empty. Doctor must check the key the app will really use: the live-agent folder's `.env`, or the environment. Two: opened from Finder, the core's messages go nowhere, so a problem like "it makes a weird sound" can't be looked into. The core writes a small rolling log file in the live-agent folder, and the window has a way to open it.

**Blocked by:** 11 Doctor check, 13 One-command install

**Status:** done

**Priority:** must-have

- [x] Doctor run from a folder with its own `.env` still reports the live-agent folder's key
- [x] An empty key in the live-agent folder makes doctor fail with the fix
- [x] Opened from Finder, the core writes its messages to a log file in the live-agent folder
- [x] The log never contains the key or any token
- [x] The log file stays small (old lines are dropped)

## Comments

2026-11-14: how the boxes were checked.
- Doctor and the key: `test/get-sh.test.ts` runs doctor from the live-agent folder, so a `.env` where `get.sh` ran is never read, and an empty key file fails with the fix. The compiled core is built with `--no-compile-autoload-dotenv` (`app/scripts/build-core.sh`), so the binary never loads a `.env` from the folder it starts in.
- The log: `test/core-log.test.ts` covers the file in `<home>/logs/core.log`, the core started like the app writing to it, no key or token in it (the launch token is hidden exactly, git commit ids stay readable), and the size cap.
