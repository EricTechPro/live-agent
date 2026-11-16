# 17: Worktrees for helper jobs

**What to build:** When worktrees are on in the config, each helper job runs in its own git worktree so it never touches the main branch. The worktree path shows on the job.

**Blocked by:** 06 Helper jobs with Gemini CLI

**Status:** done

**Priority:** after-talk

- [x] With worktrees on, a helper job runs in a new worktree
- [x] With worktrees off, behaviour is unchanged
- [x] The job shows its worktree path
- [x] A non-git project gives a clear message instead of failing silently

## Comments

2026-11-14: unparked by Eric ("finish all the tickets").

2026-11-14, built (`src/helpers/worktree.ts`, adapter-agnostic so ticket 18 reuses it):
- Branch `live-agent/<task-slug>-<UTC yyyymmdd-hhmmss>` from the user's HEAD; worktree at
  `<app-data>/live-agent/worktrees/<repo>/<leaf>`, outside every project. Made when the job is
  queued, so every `job.state` event carries `worktree: { path, branch }`; the start and end
  tool answers carry it too, and the job board shows branch and path.
- Done: the helper's changes are committed on the branch (user's git identity, else
  `live-agent`). Failed/cancelled: nothing committed. The worktree is always kept; clean-up
  is `git worktree remove <path>` + `git branch -D <branch>` (README "Worktrees").
- Not a git folder / no commits yet: the `start_helper` call fails with a plain fix
  (`git init` + first commit, or `"worktrees": false`), and no job starts.
- Live smoke: real Gemini CLI fixed an off-by-one bug; the fix landed as a commit on the
  worktree branch, while the user's `main` (HEAD, files, status) stayed untouched.
