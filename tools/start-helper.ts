// start_helper: start a background helper job (Gemini CLI, Codex or Claude Code) on a project folder.
// Risk class "helper": the gate asks first in Ask me and Auto edits.
// The tool answers at once with the job id; the core tells the model again
// when the job ends, so the voice can announce it.
// Which helper: the one the user named ("use Claude Code"), else the first one
// turned on in the config (src/helpers/index.ts).
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { defineTool } from "../src/core/tool.ts";
import { shortTitle } from "../src/helpers/cli-job.ts";
import { HELPER_IDS, pickHelper } from "../src/helpers/index.ts";
import { createWorktree, inWorktree } from "../src/helpers/worktree.ts";

export default defineTool<{ task: string; title?: string; folder?: string; helper?: string }>({
  name: "start_helper",
  description:
    "Start a helper coding agent in the background for anything that needs the computer: git status or diffs, " +
    "reading or changing code, files outside the notes, running commands, fixing or building something. " +
    "Use it instead of saying you cannot. Say one short line first (\"Sending that to Claude Code.\"). " +
    "Returns a job id right away; do not wait for it. " +
    "You will get another result for this call when the job ends: then tell the user how it went. " +
    "If a result has a worktree, the helper works on that git branch, not the user's: say the branch name.",
  risk: "helper",
  parameters: {
    type: "object",
    properties: {
      task: { type: "string", description: "What the helper should do, in plain words." },
      title: {
        type: "string",
        description: "A short title for the job card, 2 to 6 words (\"Fix flaky login test\"). Default: made from the task.",
      },
      folder: {
        type: "string",
        description:
          "Project folder to work in: the user's notes folder, a project inside it (projects/<name>), or a path the user said. " +
          "Relative paths start in the notes folder. Default: the user's notes folder.",
      },
      helper: {
        type: "string",
        enum: [...HELPER_IDS],
        description:
          "Which helper to use, only if the user named one (\"use Codex\", \"use Claude Code\"). " +
          "Leave it out otherwise: the first helper turned on in the config is used.",
      },
    },
    required: ["task"],
  },
  async run({ task, title, folder, helper: asked }, { brainPath, jobs, helpers }) {
    if (!jobs || !helpers) throw new Error("helper jobs are not available in this session");
    const { geminiCli, codex = false, claudeCode = false, worktrees, ...paths } = helpers;
    // Off, or none on: a plain fix for the voice, and no job starts.
    const helper = pickHelper({ geminiCli, codex, claudeCode }, asked);
    // Not installed or not signed in: the same, before any worktree or branch is made.
    const status = await helper.status(paths);
    if (!status.ok) throw new Error(status.fix ?? `${helper.label} is not ready.`);
    // Ticket 21: the brain folder, never the app's home (the core's working folder).
    const project = resolve(brainPath, folder ?? ".");
    if (!existsSync(project) || !statSync(project).isDirectory()) {
      throw new Error(
        `The folder ${project} does not exist. Leave the folder out to work in the notes folder, ` +
          "use projects/<name> for a project inside it, or say the full path.",
      );
    }
    // Worktrees on: the helper works on its own branch, never in the user's checkout.
    // Not a git project: createWorktree throws a plain fix, and no job starts.
    const worktree = worktrees ? createWorktree({ folder: project, task, root: paths.worktreesRoot }) : undefined;
    const spec = {
      ...helper.job({ task, cwd: worktree?.cwd ?? project, ...paths }),
      folder: project,
      // Ticket 29: the model's short title for the card; else the adapter's, made from the task.
      ...(title?.trim() ? { title: shortTitle(title) } : {}),
    };
    const jobId = jobs.submit(worktree ? inWorktree(spec, worktree) : spec);
    const job = jobs.list().find((j) => j.id === jobId)!;
    return { jobId, helper: helper.id, state: job.state, folder: project, ...(job.worktree ? { worktree: job.worktree } : {}) };
  },
});
