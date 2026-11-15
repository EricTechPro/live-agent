// The helper adapters, behind one small interface (ticket 18).
//
//   const helper = pickHelper(config.helpers, "claude-code");  // throws a plain fix if it is off
//   jobs.submit(helper.job({ task, cwd, ...paths }));
//   await helper.status(paths);                                 // the doctor: installed and signed in?
//
// Each adapter (gemini-cli.ts, codex.ts, claude-code.ts) knows its own CLI:
// how to tell it is installed and ready (with one plain fix if not), the
// command line, and what its exit codes and output mean. What they share
// (spawn headless, process-group cancel, the hard-exit watchdog) is in
// cli-job.ts; the worktree (worktree.ts) just gives them a different cwd.
//
// Turning a helper on in the config is what allows it. The order below is the
// default order: with no helper named, the first one turned on is used.
import type { Config } from "../config/index.ts";
import type { JobSpec } from "../core/jobs.ts";
import { claudeCodeJob, claudeCodeStatus } from "./claude-code.ts";
import { codexJob, codexStatus } from "./codex.ts";
import { geminiCliJob, geminiCliStatus, type HelperPaths } from "./gemini-cli.ts";

/** What the voice may name in start_helper. */
export const HELPER_IDS = ["gemini-cli", "codex", "claude-code"] as const;
export type HelperId = (typeof HELPER_IDS)[number];

/** Installed, and signed in (or has its key)? `fix` says what to do when not. */
export interface HelperStatus {
  ok: boolean;
  installed: boolean;
  bin?: string;
  fix?: string;
}

export interface HelperAdapter {
  id: HelperId;
  /** The name people say: "Claude Code". */
  label: string;
  /** Its on/off switch in the config's `helpers`. */
  configKey: "geminiCli" | "codex" | "claudeCode";
  status(paths: HelperPaths): Promise<HelperStatus>;
  job(options: HelperPaths & { task: string; cwd: string }): JobSpec;
}

export const HELPERS: readonly HelperAdapter[] = [
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    configKey: "geminiCli",
    status: async (p) => geminiCliStatus({ bin: p.geminiCliBin, ...(p.geminiApiKey !== undefined ? { apiKey: p.geminiApiKey } : {}) }),
    job: geminiCliJob,
  },
  { id: "codex", label: "Codex", configKey: "codex", status: codexStatus, job: codexJob },
  { id: "claude-code", label: "Claude Code", configKey: "claudeCode", status: claudeCodeStatus, job: claudeCodeJob },
];

const TURN_ON = "Turn it on in setup, or in live-agent.config.json";

/**
 * The helper to use: the one asked for, or the first one turned on.
 * Throws a plain message with the fix when it is off or none is on.
 */
export function pickHelper(on: Pick<Config["helpers"], "geminiCli" | "codex" | "claudeCode">, asked?: string): HelperAdapter {
  if (asked) {
    const helper = HELPERS.find((h) => h.id === asked);
    if (!helper) throw new Error(`there is no helper called "${asked}". Helpers: ${HELPER_IDS.join(", ")}`);
    if (!on[helper.configKey]) {
      throw new Error(`the ${helper.label} helper is turned off (helpers.${helper.configKey} is false in the config). ${TURN_ON}.`);
    }
    return helper;
  }
  const first = HELPERS.find((h) => on[h.configKey]);
  if (!first) throw new Error(`every helper is turned off in the config (helpers.geminiCli, helpers.codex, helpers.claudeCode). ${TURN_ON}.`);
  return first;
}
