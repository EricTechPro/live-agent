// Worktrees for helper jobs (config `worktrees`, ticket 17).
//
//   const worktree = createWorktree({ folder: "/path/to/project", task: "fix the add bug" });
//   jobs.submit(inWorktree(geminiCliJob({ task, cwd: worktree.cwd }), worktree));
//
// Why: a helper edits files with nobody watching. With worktrees on, it works
// in its own git worktree on its own branch, so the user's checkout (branch,
// files, uncommitted work) is never touched.
//
// Decisions:
// - Adapter-agnostic: this module knows git, not any one CLI. Every helper
//   adapter (Gemini CLI, Codex, Claude Code) just runs in `worktree.cwd`.
// - Branch `live-agent/<task-slug>-<yyyymmdd-hhmmss>`, made from the user's
//   current commit (HEAD). Uncommitted changes in the project are not copied.
// - Worktrees live outside every project, in live-agent's app-data folder:
//   `<app-data>/live-agent/worktrees/<repo-name>/<branch leaf>`
//   (macOS: ~/Library/Application Support/live-agent/worktrees/...).
//   Inside the project, `git status` would list them as new files.
// - The worktree is made when the job is queued, so the job's first event
//   already carries its path and branch.
// - Done: everything the helper changed is committed on the branch, so the user
//   can review it from their own checkout (`git diff main...<branch>`, merge it).
//   Failed or cancelled: nothing is committed; the changes stay in the worktree.
// - The worktree is always kept for review. Clean up with
//   `git worktree remove <path>` and `git branch -D <branch>` (in the project).
// - Not a git project, or no commits yet: throw a plain message with the fix,
//   so the voice says it and no job starts.
import { existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { JobSpec } from "../core/jobs.ts";
import { liveAgentDataDir } from "./cli-job.ts";

/** Where a job's worktree is. Plain JSON: it rides on the job's events. */
export interface WorktreeInfo {
  /** The worktree folder. */
  path: string;
  /** Its new branch, e.g. `live-agent/fix-the-add-bug-20261114-101500`. */
  branch: string;
}

export interface Worktree extends WorktreeInfo {
  /** Where the helper should run: the asked-for folder inside the worktree. */
  cwd: string;
}

/** Default home for helper worktrees: live-agent's app-data folder. */
export function defaultWorktreesRoot(): string {
  return join(liveAgentDataDir(), "worktrees");
}

function git(cwd: string, args: string[]) {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { ok: r.exitCode === 0, out: r.stdout.toString().trim(), err: r.stderr.toString().trim() };
}

const OFF_FIX = 'or turn worktrees off ("worktrees": false in live-agent.config.json)';

/** Make a new worktree on a new branch for one helper job. Throws a plain message with the fix. */
export function createWorktree({
  folder,
  task,
  root = defaultWorktreesRoot(),
  now = new Date(),
}: { folder: string; task: string; root?: string; now?: Date }): Worktree {
  if (!existsSync(folder)) throw new Error(`The folder ${folder} does not exist.`);
  const top = git(folder, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) {
    throw new Error(
      `${folder} is not a git project, so the helper cannot get its own worktree. ` +
        `Fix: run "git init" there and make a first commit, ${OFF_FIX}.`,
    );
  }
  if (!git(folder, ["rev-parse", "--verify", "-q", "HEAD"]).ok) {
    throw new Error(
      `${top.out} has no commits yet, so there is nothing to start a worktree from. ` +
        `Fix: make a first commit there, ${OFF_FIX}.`,
    );
  }

  const slug = task.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40).replace(/-$/, "") || "job";
  const stamp = now.toISOString().replace(/\.\d+Z$/, "").replace(/[-:]/g, "").replace("T", "-");
  const base = join(root, basename(top.out));
  let leaf = `${slug}-${stamp}`;
  for (let n = 2; existsSync(join(base, leaf)) || git(top.out, ["rev-parse", "--verify", "-q", `refs/heads/live-agent/${leaf}`]).ok; n++) {
    leaf = `${slug}-${stamp}-${n}`;
  }
  const branch = `live-agent/${leaf}`;
  const path = join(base, leaf);
  mkdirSync(base, { recursive: true });
  const add = git(top.out, ["worktree", "add", "-q", "-b", branch, path, "HEAD"]);
  if (!add.ok) throw new Error(`Could not make a git worktree for the helper: ${add.err}`);
  // The asked-for folder may be a subfolder of the repo: run in the same place inside the worktree.
  const sub = git(folder, ["rev-parse", "--show-prefix"]).out; // e.g. "packages/app/", "" at the top
  return { path, branch, cwd: sub ? join(path, sub) : path };
}

/** The job, tagged with its worktree; when it ends done, its changes are committed on the branch. */
export function inWorktree(spec: JobSpec, { path, branch }: WorktreeInfo): JobSpec {
  return {
    ...spec,
    worktree: { path, branch },
    async run(job) {
      const summary = await spec.run(job);
      if (!job.signal.aborted) commitAll(path, spec.title);
      return summary;
    },
  };
}

function commitAll(path: string, title: string) {
  if (!git(path, ["status", "--porcelain"]).out) return;
  git(path, ["add", "-A"]);
  // Use the user's git name if they have one; else commit as live-agent, so the commit never fails on identity.
  const who = git(path, ["config", "user.email"]).ok ? [] : ["-c", "user.name=live-agent", "-c", "user.email=live-agent@localhost"];
  const r = git(path, [...who, "commit", "-q", "--no-verify", "-m", `live-agent helper: ${title}`]);
  if (!r.ok) throw new Error(`The helper finished, but its changes could not be committed in ${path}: ${r.err}`);
}
