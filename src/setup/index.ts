// Setup: the wizard's typed answers go into the config file.
//
//   saveSetup(configPath, { voice: "Kore", tone: "short", brainPath: "/Users/me/notes",
//                           brainFolders: { raw: "_inbox", wiki: "notes", projects: "projects" },
//                           safetyMode: "auto-edits" });
//
// Why typed answers (no model): the window's click-through wizard knows exactly
// what was picked, so nothing can be misheard, and saving needs no Gemini key.
// POST /setup/save (src/app.ts) calls this, then the session uses the result at once.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { brainRoot } from "../brain/index.ts";
import {
  checkConfig,
  ConfigError,
  defaultConfig,
  type BrainFolders,
  type Config,
  type SafetyMode,
  type Tone,
} from "../config/index.ts";

/** The wizard's answers. Every answer is optional: one left out keeps the current value. */
export interface SetupAnswers {
  brainPath?: string | null;
  /** The folder inside the brain for each part. Missing folders are created on save. */
  brainFolders?: Partial<BrainFolders> | null;
  safetyMode?: SafetyMode | null;
  voice?: string | null;
  tone?: Tone | null;
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

/** The config as it is now (defaults when there is no file): what the wizard starts from. */
export function currentConfig(configPath: string): Config {
  return existsSync(configPath) ? checkConfig(readRaw(configPath)) : defaultConfig();
}

// "~/notes" is how people write it; the config wants a real path.
function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
}

const given = <T>(value: T | null | undefined): value is T => value !== undefined && value !== null && value !== "";

const isFolder = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/**
 * Merge the answers into the config file and write it, then create any brain
 * part folder that is missing.
 *
 * Why merge over the raw file: re-running setup must only change what was
 * asked. Fields setup never asks about (worktrees, per-tool overrides) stay
 * exactly as they were. The whole filled config is written, so the user can
 * see and edit every setting later.
 *
 * Throws ConfigError (and writes nothing) for a bad answer, a brain folder
 * that does not exist, or two parts mapped to the same folder.
 */
export function saveSetup(configPath: string, answers: SetupAnswers): { config: Config } {
  const raw = readRaw(configPath);
  const next: Record<string, any> = {
    ...raw,
    safety: { ...raw.safety },
    helpers: { ...raw.helpers },
    brainFolders: { ...raw.brainFolders },
  };
  if (given(answers.brainPath)) next.brainPath = expandHome(answers.brainPath.trim());
  for (const part of ["raw", "wiki", "projects"] as const) {
    const folder = answers.brainFolders?.[part];
    if (given(folder)) next.brainFolders[part] = folder.trim();
  }
  if (given(answers.safetyMode)) next.safety.mode = answers.safetyMode;
  if (given(answers.voice)) next.voice = answers.voice;
  if (given(answers.tone)) next.tone = answers.tone;
  for (const key of ["geminiCli", "codex", "claudeCode"] as const) {
    if (given(answers.helpers?.[key])) next.helpers[key] = answers.helpers[key];
  }
  if (given(answers.maxAtOnce)) next.helpers.maxAtOnce = answers.maxAtOnce;

  const config = checkConfig(next); // throws ConfigError naming the bad answer; nothing is written
  const root = brainRoot(config.brainPath);
  if (!isFolder(root)) throw new ConfigError(`The notes folder ${config.brainPath} does not exist. Pick a folder that is there.`);
  const folders = Object.values(config.brainFolders);
  if (new Set(folders.map((f) => f.toLowerCase())).size !== folders.length) {
    throw new ConfigError("raw, wiki and projects need three different folders.");
  }
  const lower = Object.entries(config.brainFolders).map(([part, f]) => [part, f.toLowerCase()] as const);
  for (const [outer, o] of lower) {
    for (const [inner, i] of lower) {
      if (inner !== outer && i.startsWith(`${o}/`)) throw new ConfigError(`The ${inner} folder cannot sit inside the ${outer} folder.`);
    }
  }

  writeConfig(configPath, raw, config);

  // An empty folder gets all three parts; a mapped one only what it lacks.
  for (const folder of folders) mkdirSync(join(root, folder), { recursive: true });
  return { config };
}

// Keys in the schema's order, so the file reads the same way every time.
function writeConfig(configPath: string, raw: Record<string, any>, config: Config) {
  const file: Record<string, unknown> = raw.$schema ? { $schema: raw.$schema } : {};
  for (const key of Object.keys(defaultConfig())) file[key] = config[key as keyof Config];
  mkdirSync(dirname(configPath), { recursive: true });
  // Write a temp file, then rename: a crash mid-write never leaves half a config.
  const temp = `${configPath}.tmp-${process.pid}`;
  writeFileSync(temp, JSON.stringify(file, null, 2) + "\n");
  renameSync(temp, configPath);
}

/**
 * Save Jett's voice and speaking style (the set_voice tool) into the same file
 * the wizard writes. Only these two change; an empty `voiceStyle` clears the style.
 * Throws ConfigError (and writes nothing) for a bad value or an unreadable file.
 */
export function saveVoice(configPath: string, change: { voice?: string; voiceStyle?: string }): { config: Config } {
  const raw = readRaw(configPath);
  const next: Record<string, any> = { ...raw };
  if (change.voice !== undefined) next.voice = change.voice;
  if (change.voiceStyle !== undefined) next.voiceStyle = change.voiceStyle.trim();
  const config = checkConfig(next);
  writeConfig(configPath, raw, config);
  return { config };
}
