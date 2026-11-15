# 20: Doctor reads the right key, and the core keeps a log

**What to build:** Two fixes from Eric's first real install. One: the installer's doctor said "key works" because it picked up a `.env` from the folder it was run in, while the app's own key file was empty. Doctor must check the key the app will really use: the live-agent folder's `.env`, or the environment. Two: opened from Finder, the core's messages go nowhere, so a problem like "it makes a weird sound" can't be looked into. The core writes a small rolling log file in the live-agent folder, and the window has a way to open it.

**Blocked by:** 11 Doctor check, 13 One-command install

**Status:** ready-for-agent

**Priority:** must-have

- [ ] Doctor run from a folder with its own `.env` still reports the live-agent folder's key
- [ ] An empty key in the live-agent folder makes doctor fail with the fix
- [ ] Opened from Finder, the core writes its messages to a log file in the live-agent folder
- [ ] The log never contains the key or any token
- [ ] The log file stays small (old lines are dropped)
