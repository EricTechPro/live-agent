// start_helper: start a background helper job (Gemini CLI) on a project folder.
// Risk class "helper": the gate asks first in Ask me and Auto edits.
// The tool answers at once with the job id; the core tells the model again
// when the job ends, so the voice can announce it.
import { resolve } from "node:path";
import { defineTool } from "../src/core/tool.ts";
import { geminiCliJob } from "../src/helpers/gemini-cli.ts";
import { createWorktree, inWorktree } from "../src/helpers/worktree.ts";

export default defineTool<{ task: string; folder?: string }>({
  name: "start_helper",
  description:
    "Start a helper coding agent (Gemini CLI) in the background to do real work in a project folder, " +
    "e.g. fix a bug or write code. Returns a job id right away; do not wait for it. " +
    "You will get another result for this call when the job ends: then tell the user how it went. " +
    "If a result has a worktree, the helper works on that git branch, not the user's: say the branch name.",
  risk: "helper",
  parameters: {
    type: "object",
    properties: {
      task: { type: "string", description: "What the helper should do, in plain words." },
      folder: {
        type: "string",
        description: "Project folder to work in. Relative paths start in the working folder. Default: the working folder.",
      },
    },
    required: ["task"],
  },
  run({ task, folder }, { workDir, jobs, helpers }) {
    if (!jobs || !helpers) throw new Error("helper jobs are not available in this session");
    const { geminiCli, worktrees, ...paths } = helpers;
    if (!geminiCli) {
      throw new Error("the Gemini CLI helper is turned off (helpers.geminiCli is false in the config)");
    }
    const project = resolve(workDir, folder ?? ".");
    // Worktrees on: the helper works on its own branch, never in the user's checkout.
    // Not a git project: createWorktree throws a plain fix, and no job starts.
    const worktree = worktrees ? createWorktree({ folder: project, task, root: paths.worktreesRoot }) : undefined;
    const spec = geminiCliJob({ task, cwd: worktree?.cwd ?? project, ...paths });
    const jobId = jobs.submit(worktree ? inWorktree(spec, worktree) : spec);
    const job = jobs.list().find((j) => j.id === jobId)!;
    return { jobId, state: job.state, ...(job.worktree ? { worktree: job.worktree } : {}) };
  },
});
