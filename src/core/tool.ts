// What a tool is. Every file in the `tools/` folder default-exports one of these.
//
//   // tools/say-hi.ts
//   import { defineTool } from "../src/core/tool.ts";
//   export default defineTool({
//     name: "say_hi",
//     description: "Say hi to someone by name.",
//     risk: "read",
//     parameters: { type: "object", properties: { who: { type: "string" } }, required: ["who"] },
//     async run({ who }) { return { greeting: `hi ${who}` }; },
//   });
//
// Why a risk class on every tool: the safety gate decides by risk class and
// mode (see src/core/safety.ts), so a new tool is safe by declaring one word.

import type { Config } from "../config/index.ts";
import type { HelperPaths } from "../helpers/gemini-cli.ts";
import type { Jobs } from "./jobs.ts";
import type { GateState, Ruling } from "./safety.ts";

export type RiskClass = "read" | "edit" | "command" | "helper";

/** What a running tool gets besides its args. */
export interface ToolContext {
  /** The folder relative paths are read from (the session's `workDir`). */
  workDir: string;
  /** The brain folder (config `brainPath`, resolved to an absolute path). */
  brainPath: string;
  /** Report brain notes (paths inside the brain) this turn's answer used. The core emits `notes.used`. */
  useNotes(paths: string[]): void;
  /** Report a note this tool wrote into the brain (path inside the brain). The core emits `brain.write` right away. */
  brainWrote(path: string): void;
  /** Show a diagram (Mermaid source) in the window. The core emits `diagram` right away. */
  showDiagram(diagram: { source: string; title?: string }): void;
  /**
   * The orchestrator (src/core/jobs.ts). A job submitted from a tool call is
   * tied to that call: the core tells the model when the job ends.
   */
  jobs?: Pick<Jobs, "submit" | "cancel" | "list">;
  /** Helper settings: which helpers are on (config `helpers`) and where their CLIs are. */
  helpers?: HelperSettings;
  /** The setup chat (ticket 12): where the config file lives, and "it was saved" (the core emits `setup.saved`). */
  setup?: { configPath: string; saved(config: Config): void };
}

export interface HelperSettings extends HelperPaths {
  /** Config `helpers.geminiCli`: is the Gemini CLI helper turned on? */
  geminiCli: boolean;
  /** Config `helpers.codex`: is the Codex helper turned on? */
  codex?: boolean;
  /** Config `helpers.claudeCode`: is the Claude Code helper turned on? */
  claudeCode?: boolean;
  /** Config `worktrees`: does each helper job get its own git worktree? */
  worktrees?: boolean;
}

export interface Tool<Args extends Record<string, any> = Record<string, any>> {
  /** The name the model calls. Letters, digits and underscores. */
  name: string;
  /** Tells the model when to use the tool. Write it for the model, not for people. */
  description: string;
  risk: RiskClass;
  /** JSON Schema of the args object. */
  parameters: Record<string, unknown>;
  /**
   * Optional: the tool's own gate rule, used instead of the mode table (a
   * config override still wins). Return undefined to fall back to the table.
   * Most tools never need this; save_setup does.
   */
  gate?(state: GateState): Ruling | undefined;
  /** Do the work. Return plain JSON for the model; throw to report an error. */
  run(args: Args, context: ToolContext): Promise<unknown> | unknown;
}

/** Identity helper: gives a tool file type checking with no extra imports. */
export function defineTool<Args extends Record<string, any>>(tool: Tool<Args>): Tool {
  return tool as unknown as Tool;
}
