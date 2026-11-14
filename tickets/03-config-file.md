# 03: Config file

**What to build:** One JSON config file controls live-agent, with a JSON Schema. Defaults: safety mode Auto edits, helpers max 1, worktrees off, Gemini CLI on, Codex and Claude Code off, brain path pointing at the sample brain. Per-tool risk overrides win over the mode table. The agent core reads it at session start.

**Blocked by:** 01 Text turn through the agent core

**Status:** done

**Priority:** must-have

- [x] A missing config file falls back to the documented defaults
- [x] An invalid config fails with a clear message naming the bad field
- [x] Changing the safety mode in the config changes gate verdicts (checked through the event stream)
- [x] A per-tool override beats the mode table
- [x] The schema file is committed and describes every field
