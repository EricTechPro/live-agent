# 18: Codex and Claude Code helpers

**What to build:** Codex and Claude Code join Gemini CLI as helper adapters, each turned on in the config. Each checks it is installed and signed in before running.

**Blocked by:** 06 Helper jobs with Gemini CLI

**Status:** done

**Priority:** after-talk

- [x] Turning on Codex in the config lets the agent start Codex jobs
- [x] Turning on Claude Code in the config lets the agent start Claude Code jobs
- [x] A missing or signed-out CLI gives a clear fix
- [x] The user can say which helper to use, and the default is the first one turned on

## Comments

2026-11-14: unparked by Eric ("finish all the tickets").

2026-11-14: built. One adapter per CLI behind `src/helpers/index.ts` (status with a plain fix, job; shared spawn, process-group cancel and watchdog in `src/helpers/cli-job.ts`). Codex: `codex exec --json --sandbox workspace-write --skip-git-repo-check`, ready = `codex login status`. Claude Code: `claude -p --output-format json --permission-mode bypassPermissions --no-session-persistence`, ready = `claude auth status`. Neither gets the Gemini key. `start_helper` takes an optional `helper` (gemini-cli, codex, claude-code); default is the first one turned on. Setup chat asks about all three; doctor fails a turned-on helper that is missing or signed out, warns when off.
Live (`smoke/helpers-smoke.test.ts`, real Gemini Live, worktrees on): Codex and Claude Code each fixed an off-by-one on their worktree branch and the voice announced it. On Eric's machine `~/.codex/config.toml` picks `gpt-6.1-sol`, which the Codex CLI rejects for a ChatGPT account (the job fails saying where to change it); the live run used a wrapper passing `-c model="gpt-6-sol"` and his config was left alone. One Claude Code run failed once with "No messages returned from query" (transient; the retry passed).
