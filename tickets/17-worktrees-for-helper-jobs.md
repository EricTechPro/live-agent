# 17: Worktrees for helper jobs

**What to build:** When worktrees are on in the config, each helper job runs in its own git worktree so it never touches the main branch. The worktree path shows on the job.

**Blocked by:** 06 Helper jobs with Gemini CLI

**Status:** wontfix (parked until after the Nov 27 talk; set back to ready-for-agent to build)

**Priority:** after-talk

- [ ] With worktrees on, a helper job runs in a new worktree
- [ ] With worktrees off, behaviour is unchanged
- [ ] The job shows its worktree path
- [ ] A non-git project gives a clear message instead of failing silently
