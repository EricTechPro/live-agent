// Workflows and skills: plain files in Jett's home (the folder the config is read
// from: LIVE_AGENT_HOME when installed, the repo when run from source).
//
//   <home>/.agents/workflows/<name>.md      one workflow: frontmatter + instructions
//   <home>/.agents/skills/<name>/SKILL.md   one skill, the standard Claude / Codex format
//
// A workflow file:
//
//   ---
//   name: morning-news
//   description: Sum up the AI news
//   trigger: "0 8 * * 1-5"        # `manual`, or a 5-field cron (src/workflows/cron.ts)
//   helper: codex                 # optional: gemini-cli, codex or claude-code
//   ---
//   Find today's AI news and write a short digest into raw/.
//
// The body is sent as the helper's task. Why files: people can read and edit
// them, and the model makes them with create_workflow.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JobSpec } from "../core/jobs.ts";
import type { HelperSettings } from "../core/tool.ts";
import { HELPER_IDS, pickHelper } from "../helpers/index.ts";
import { parseCron } from "./cron.ts";

export interface Workflow {
  name: string;
  description: string;
  /** `manual`, or a 5-field cron. */
  trigger: string;
  helper?: string;
  instructions: string;
  /** Set when the file cannot be used: what is wrong. Such a workflow never runs. */
  error?: string;
}

export const workflowsDir = (home: string) => join(home, ".agents", "workflows");
export const skillsDir = (home: string) => join(home, ".agents", "skills");

/** "Morning News!" -> "morning-news": the file name and the name the model calls it by. */
export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// `key: value` lines between `---` fences; one pair of quotes stripped. Enough for our headers.
function frontmatter(text: string): { fields: Record<string, string>; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fields: {}, body: text.trim() };
  const fields: Record<string, string> = {};
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_-]+):\s*(.*?)\s*$/);
    if (kv) fields[kv[1]!] = kv[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
  return { fields, body: m[2]!.trim() };
}

/** Throws a plain message if the trigger or helper cannot be used. */
function check(trigger: string, helper?: string) {
  if (trigger !== "manual") parseCron(trigger);
  if (helper && !(HELPER_IDS as readonly string[]).includes(helper)) {
    throw new Error(`there is no helper called "${helper}". Helpers: ${HELPER_IDS.join(", ")}`);
  }
}

export function listWorkflows(home: string): Workflow[] {
  const dir = workflowsDir(home);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((file) => {
      const { fields, body } = frontmatter(readFileSync(join(dir, file), "utf8"));
      const wf: Workflow = {
        name: file.slice(0, -3),
        description: fields.description ?? "",
        trigger: fields.trigger || "manual",
        ...(fields.helper ? { helper: fields.helper } : {}),
        instructions: body,
      };
      try {
        check(wf.trigger, wf.helper);
        if (!wf.instructions) throw new Error("it has no instructions under the header");
      } catch (err) {
        wf.error = (err as Error).message;
      }
      return wf;
    });
}

export function findWorkflow(home: string, name: string): Workflow {
  const wf = listWorkflows(home).find((w) => w.name === slug(name));
  if (!wf) {
    const names = listWorkflows(home).map((w) => w.name);
    throw new Error(`there is no workflow called "${name}". Workflows: ${names.join(", ") || "none yet"}`);
  }
  if (wf.error) throw new Error(`the workflow "${wf.name}" cannot run: ${wf.error}`);
  return wf;
}

/** Write (or replace) a workflow file. Checks the trigger and helper first; a bad one writes nothing. */
export function saveWorkflow(
  home: string,
  wf: { name: string; description: string; trigger: string; instructions: string; helper?: string },
): { name: string; path: string } {
  const name = slug(wf.name);
  if (!name) throw new Error("the workflow needs a name with letters or digits");
  const trigger = wf.trigger.trim() || "manual";
  check(trigger, wf.helper);
  const header = [
    "---",
    `name: ${name}`,
    `description: ${wf.description.replace(/\s+/g, " ").trim()}`,
    `trigger: "${trigger}"`,
    ...(wf.helper ? [`helper: ${wf.helper}`] : []),
    "---",
  ];
  mkdirSync(workflowsDir(home), { recursive: true });
  const path = join(workflowsDir(home), `${name}.md`);
  writeFileSync(path, `${header.join("\n")}\n\n${wf.instructions.trim()}\n`);
  return { name, path };
}

/** Delete a workflow file. False when there is none. */
export function deleteWorkflow(home: string, name: string): boolean {
  const file = slug(name);
  if (!file || file !== name.toLowerCase().trim()) throw new Error(`"${name}" is not a workflow name`);
  const path = join(workflowsDir(home), `${file}.md`);
  if (!existsSync(path)) return false;
  rmSync(path);
  return true;
}

export function listSkills(home: string): { name: string; description: string }[] {
  const dir = skillsDir(home);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .filter((d) => existsSync(join(dir, d, "SKILL.md")))
    .map((d) => {
      const { fields } = frontmatter(readFileSync(join(dir, d, "SKILL.md"), "utf8"));
      return { name: fields.name || d, description: fields.description ?? "" };
    });
}

/**
 * The task a helper gets, plus where the skills are. Why in the task: Codex reads
 * `.agents/skills` only from its own folder up to the git root and Claude Code only
 * `.claude/skills`, and helpers work in the brain or a worktree, so neither would
 * find Jett's skills on its own. Naming the folder works for every helper.
 */
export function helperTask(task: string, home: string): string {
  const skills = listSkills(home);
  if (!skills.length) return task;
  return [
    task,
    "",
    `Skills you can use live in ${skillsDir(home)} (one folder each, with a SKILL.md). ` +
      "If one fits this task, read its SKILL.md first and follow it:",
    ...skills.map((s) => `- ${s.name}: ${s.description}`),
  ].join("\n");
}

/** For the system prompt: the workflows and skills, one line each. Empty when there are none. */
export function catalog(home: string): string {
  const workflows = listWorkflows(home).filter((w) => !w.error);
  const skills = listSkills(home);
  const out: string[] = [];
  if (workflows.length) {
    out.push("Workflows (run_workflow by name):", ...workflows.map((w) => `- ${w.name}: ${w.description} (${w.trigger})`));
  }
  if (skills.length) out.push("Skills (helpers can use them):", ...skills.map((s) => `- ${s.name}: ${s.description}`));
  return out.join("\n");
}

/**
 * The helper job for one workflow, working in the brain folder. A workflow with no
 * `helper` uses the config `defaultHelper` (if it is on). Throws a plain fix when its
 * helper (or every helper) is turned off.
 */
export function workflowJob(wf: Workflow, where: { home: string; brainPath: string; helpers: HelperSettings }): JobSpec {
  const { geminiCli, codex = false, claudeCode = false, worktrees: _, defaultHelper, ...paths } = where.helpers;
  const helper = pickHelper({ geminiCli, codex, claudeCode }, wf.helper, defaultHelper);
  return {
    ...helper.job({ task: helperTask(wf.instructions, where.home), cwd: where.brainPath, ...paths }),
    title: wf.name,
    folder: where.brainPath,
  };
}
