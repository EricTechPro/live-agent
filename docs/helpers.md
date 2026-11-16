# Helper agents

Gemini Live is the boss. It talks; helpers do the slow work.

- **Start one by asking.** "Fix the off-by-one bug in ~/code/recipe-box." Gemini calls
  `start_helper`, which starts a helper in that folder in the background and answers at
  once with a job id. The voice keeps talking with you.
- **Pick the helper.** Three helpers, each turned on in the config: **Gemini CLI**, **Codex**
  and **Claude Code**. Say "use Claude Code to..." to pick one. If you don't say, the first one
  turned on is used, in that order. Naming one that is turned off, not installed or not signed
  in gets a plain fix instead of a job.
- **Gemini CLI runs on your key.** It uses the same Gemini key as the voice, with its own
  private Gemini CLI settings folder, so your own `gemini` login and settings are never touched.
  (Google ended Gemini CLI's free "Login with Google" tier, so the key is the way in.)
  Install Gemini CLI once: `npm install -g @google/gemini-cli`.
- **Codex and Claude Code run on your own sign-in** with OpenAI and Anthropic, and use your
  plan or API credit. live-agent never signs in for you and never hands them your Gemini key.
  - Codex: `npm install -g @openai/codex`, then `codex login` once. Runs
    `codex exec --json --sandbox workspace-write`: it edits files and runs commands inside the
    folder only. It uses the model in your `~/.codex/config.toml`; if your account can't use
    that model, the job fails saying so.
  - Claude Code: `npm install -g @anthropic-ai/claude-code`, then `claude auth login` once.
    Runs `claude -p --output-format json --permission-mode bypassPermissions`
    (nobody is there to answer its permission prompts) and does not save the run to your
    session list.
- **Max at once.** `helpers.maxAtOnce` jobs run at a time. More jobs wait as **Waiting**.
- **Follow along.** The job board shows each job as Waiting, Working, Done, Failed or Cancelled.
  When a job ends, the agent says how it went.
- **Cancel.** Press **Cancel** on the job, or say "stop job 1" (the `cancel_job` tool).
- **Safety.** Helpers are the `helper` risk class: in Ask me and Auto edits the agent asks
  first. Once started, a helper does not ask again (Gemini CLI "yolo", Codex's workspace
  sandbox, Claude Code's bypass mode), so only point it at code you are happy for it to change.
  Turn on [worktrees](#worktrees) and it works on its own branch instead.
- **Cancel stops everything it started.** Each helper runs in its own process group, and the
  group is stopped on cancel, on quit, or if the core crashes.

## Worktrees

Set `"worktrees": true` in `live-agent.config.json` and each helper job works in its own
git worktree on a new branch, so your current branch, files and uncommitted work are never
touched.

- **Branch:** `live-agent/<task>-<date-time>`, made from your current commit (uncommitted
  changes are not copied in).
- **Where:** `~/Library/Application Support/live-agent/worktrees/<project>/<branch leaf>`
  (Linux: `~/.local/share/live-agent/worktrees/...`), outside your project. The job board
  shows the branch and path, and the agent says the branch when it announces the job.
- **When done:** the helper's changes are committed on that branch. Review and merge from
  your project: `git diff main...live-agent/<...>`, then `git merge live-agent/<...>`.
  A failed or cancelled job commits nothing; its changes stay in the worktree.
- **Clean up:** worktrees are kept for you to review. Remove one with
  `git worktree remove <path>` and `git branch -D <branch>` in your project
  (`git worktree list` shows them all).
- **Not a git project?** The agent says so and starts nothing. Run `git init` and make a
  first commit there, or turn worktrees off.
