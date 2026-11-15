# 17: Worktrees for helper jobs

**What to build:** When worktrees are on in the config, each helper job runs in its own git worktree so it never touches the main branch. The worktree path shows on the job.

**Blocked by:** 06 Helper jobs with Gemini CLI

**Status:** ready-for-agent

**Priority:** after-talk

- [ ] With worktrees on, a helper job runs in a new worktree
- [ ] With worktrees off, behaviour is unchanged
- [ ] The job shows its worktree path
- [ ] A non-git project gives a clear message instead of failing silently

## Comments

2026-11-14: unparked by Eric ("finish all the tickets").
