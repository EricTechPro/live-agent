# 12: Setup chat writes the config

**What to build:** On first launch, a short setup chat (spoken or typed) asks a few questions: brain folder, safety mode, which helpers to turn on, max helpers at once. It writes the config file. It can be run again later.

**Blocked by:** 03 Config file, 09 Desktop window: orb, transcript, talk out loud

**Status:** done

**Priority:** must-have

- [x] First launch with no config starts the setup chat
- [x] Answers are saved to a config that passes the schema
- [x] Skipping a question keeps the default
- [x] Running setup again updates the existing config instead of wiping it

## Comments

- 2026-11-14 review fix: setup asks only about the Gemini CLI helper (Codex and Claude Code stay in the config, parked in ticket 18), and saved answers apply at once (safety mode, helper on/off, max at once, brain folder). No restart needed.
