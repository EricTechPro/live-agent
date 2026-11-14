# 18: Codex and Claude Code helpers

**What to build:** Codex and Claude Code join Gemini CLI as helper adapters, each turned on in the config. Each checks it is installed and signed in before running.

**Blocked by:** 06 Helper jobs with Gemini CLI

**Status:** ready-for-agent

**Priority:** after-talk

- [ ] Turning on Codex in the config lets the agent start Codex jobs
- [ ] Turning on Claude Code in the config lets the agent start Claude Code jobs
- [ ] A missing or signed-out CLI gives a clear fix
- [ ] The user can say which helper to use, and the default is the first one turned on
