// The setup chat (ticket 12): a few spoken or typed questions that write the config.
//
//   const session = await startSession({ model, configPath });
//   if (session.setup.needed()) await session.setup.start();   // first launch
//   // ...the user answers; the model calls `save_setup` (tools/save-setup.ts)
//
// Why it runs through the agent core (not a separate wizard): the same chat
// works typed in a terminal (`live-agent setup`), typed in the window, or out
// loud, and the fast tests drive it through the event stream like any turn.
//
// This module holds the two halves that are not "chat": the kickoff text that
// tells the model what to ask, and `saveSetup`, which merges the answers into
// the existing file, checks them against the schema, and writes it.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import setupPrompt from "../../prompts/setup-chat.md" with { type: "text" };
import { checkConfig, ConfigError, defaultConfig, type Config, type SafetyMode } from "../config/index.ts";

/** The tool the model calls with the answers. The core only lets it run during a setup chat. */
export const SETUP_TOOL = "save_setup";

/** What the model passes to `save_setup`. Every answer is optional: a skipped question is left out. */
export interface SetupAnswers {
  brainPath?: string | null;
  safetyMode?: SafetyMode | null;
  /** Which helper CLIs to turn on or off. */
  helpers?: { geminiCli?: boolean | null; codex?: boolean | null; claudeCode?: boolean | null } | null;
  maxAtOnce?: number | null;
}

/** Read the config file as written (not filled with defaults). Missing file: `{}`. */
function readRaw(configPath: string): Record<string, any> {
  if (!existsSync(configPath)) return {};
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf8"));
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  } catch {}
  // Never overwrite a file we cannot read: the user may have hand-edited it.
  throw new ConfigError(`${configPath} is not a valid config file. Fix it or delete it, then run setup again.`);
}

/** The config as it is now (defaults when there is no file), for the kickoff text. */
export function currentConfig(configPath: string): Config {
  return existsSync(configPath) ? checkConfig(readRaw(configPath)) : defaultConfig();
}

// "~/notes" is how people say it out loud; the config wants a real path.
function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
}

const given = <T>(value: T | null | undefined): value is T => value !== undefined && value !== null && value !== "";

/**
 * Merge the answers into the config file and write it.
 *
 * Why merge over the raw file: re-running setup must only change what was
 * asked. Fields setup never asks about (voice, worktrees, per-tool overrides)
 * stay exactly as they were. Skipped answers keep the current value, which on
 * a first run is the default. The whole filled config is written, so the
 * user can see and edit every setting later.
 */
export function saveSetup(configPath: string, answers: SetupAnswers): { config: Config; warning?: string } {
  const raw = readRaw(configPath);
  const next: Record<string, any> = { ...raw, safety: { ...raw.safety }, helpers: { ...raw.helpers } };
  if (given(answers.brainPath)) next.brainPath = expandHome(answers.brainPath.trim());
  if (given(answers.safetyMode)) next.safety.mode = answers.safetyMode;
  for (const key of ["geminiCli", "codex", "claudeCode"] as const) {
    if (given(answers.helpers?.[key])) next.helpers[key] = answers.helpers[key];
  }
  if (given(answers.maxAtOnce)) next.helpers.maxAtOnce = answers.maxAtOnce;

  const config = checkConfig(next); // throws ConfigError naming the bad answer; nothing is written
  // Keys in the schema's order, so the file reads the same way every time.
  const file: Record<string, unknown> = raw.$schema ? { $schema: raw.$schema } : {};
  for (const key of Object.keys(defaultConfig())) file[key] = config[key as keyof Config];
  mkdirSync(dirname(configPath), { recursive: true });
  // Write a temp file, then rename: a crash mid-write never leaves half a config.
  const temp = `${configPath}.tmp-${process.pid}`;
  writeFileSync(temp, JSON.stringify(file, null, 2) + "\n");
  renameSync(temp, configPath);

  const warning = existsSync(config.brainPath)
    ? undefined
    : `The brain folder ${config.brainPath} does not exist yet. live-agent creates raw/ in it when it first saves a note.`;
  return { config, warning };
}

/**
 * The hidden first message of a setup chat: what to ask, and how to save.
 * It carries the current answers, so a re-run can say "you have X, keep it?".
 */
export function setupKickoff(config: Config, firstRun: boolean): string {
  const values: Record<string, string> = {
    opening: firstRun
      ? "This is my first time using live-agent. Run the setup chat now."
      : "Run the live-agent setup chat again now. I may only want to change one or two things.",
    brainPath: config.brainPath,
    safetyMode: config.safety.mode,
    geminiCli: config.helpers.geminiCli ? "on" : "off",
    codex: config.helpers.codex ? "on" : "off",
    claudeCode: config.helpers.claudeCode ? "on" : "off",
    maxAtOnce: String(config.helpers.maxAtOnce),
    saveTool: SETUP_TOOL,
  };
  // The words live in prompts/setup-chat.md (the kit); each {{slot}} gets the current answer.
  return setupPrompt.trim().replace(/\{\{(\w+)\}\}/g, (slot, name: string) => values[name] ?? slot);
}
