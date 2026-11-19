// What every helper adapter shares: run one CLI headless as a job, and stop it.
//
//   const r = await runCli({ argv, cwd, env, signal, cancelGraceMs, onLine });
//   if (r === "cancelled") return "cancelled";
//   // else r.code (exit code) and r.stderrTail (last stderr lines) for the adapter to map
//
// - The CLI gets no stdin (headless CLIs append stdin to the prompt).
// - Each stdout line goes to `onLine` (the adapters parse their JSON events).
// - It runs in its own process group, so cancel stops the CLI and everything it
//   started: SIGINT the group (the CLIs exit cleanly), SIGKILL if it lingers.
// - A watchdog stops the group if the core is killed hard (group-watchdog.ts).
// - The user's Gemini key is never passed on: `childEnv()` drops it, and each
//   adapter adds back only what its own CLI needs.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { watchGroup } from "./group-watchdog.ts";
import type { HelperStatus } from "./index.ts";
import type { McpServers } from "./mcp.ts";

/**
 * Where the helper CLIs live and what Gemini CLI runs on. One shape all the way down:
 * the session options, the tool context and this adapter all take it as is
 * (tests point it at a fake CLI script).
 */
export interface HelperPaths {
  /** The Gemini CLI binary: a name on PATH or a path. Default "gemini". */
  geminiCliBin?: string;
  /** The Codex binary. Default "codex" (src/helpers/codex.ts). */
  codexBin?: string;
  /** The Claude Code binary. Default "claude" (src/helpers/claude-code.ts). */
  claudeCodeBin?: string;
  /** live-agent's private Gemini CLI home (its GEMINI_CLI_HOME). Default: `defaultHelperHome()`. */
  geminiCliHome?: string;
  /** The Gemini API key. Default: `geminiApiKey()` (the same key as the voice). */
  geminiApiKey?: string;
  /** How long to wait after SIGINT before SIGKILL on cancel. Default 3000 ms. */
  cancelGraceMs?: number;
  /** Where helper worktrees go (config `worktrees`). Default: `defaultWorktreesRoot()` in src/helpers/worktree.ts. */
  worktreesRoot?: string;
  /** App connections every helper job gets (config `mcpServers`, src/helpers/mcp.ts). */
  mcpServers?: McpServers;
}

/** live-agent's own folder in the OS app-data folder (the helper's CLI home, helper worktrees). */
export function liveAgentDataDir(): string {
  const home = homedir();
  const base =
    process.platform === "darwin"
      ? join(home, "Library", "Application Support")
      : process.platform === "win32"
        ? (process.env.APPDATA ?? join(home, "AppData", "Roaming"))
        : (process.env.XDG_DATA_HOME ?? join(home, ".local", "share"));
  return join(base, "live-agent");
}

export interface RunCliOptions {
  argv: string[];
  cwd: string;
  env: Record<string, string | undefined>;
  signal: AbortSignal;
  /** How long to wait after SIGINT before SIGKILL on cancel. */
  cancelGraceMs: number;
  /** Called with each stdout line. */
  onLine(line: string): void;
}

export async function runCli({ argv, cwd, env, signal, cancelGraceMs, onLine }: RunCliOptions) {
  const proc = Bun.spawn(argv, { cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", detached: true });
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const group = (sig: NodeJS.Signals) => {
    try {
      process.kill(-proc.pid, sig);
    } catch {}
  };
  const onAbort = () => {
    group("SIGINT");
    killTimer = setTimeout(() => group("SIGKILL"), cancelGraceMs);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  const stopWatch = watchGroup(proc.pid);
  try {
    const stderr = new Response(proc.stderr).text();
    await readLines(proc.stdout, onLine);
    const code = await proc.exited;
    if (signal.aborted) {
      // The CLI may be gone while children it left behind still hold the group.
      group("SIGKILL");
      return "cancelled" as const;
    }
    return { code, stderrTail: (await stderr).trim().split("\n").slice(-5).join("\n") };
  } finally {
    signal.removeEventListener("abort", onAbort);
    clearTimeout(killTimer);
    stopWatch();
  }
}

async function readLines(stdout: ReadableStream<Uint8Array>, onLine: (line: string) => void) {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of stdout) {
    buf += decoder.decode(chunk, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      onLine(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  }
  if (buf.trim()) onLine(buf);
}

/** Parse one JSON line; undefined for warnings that leaked to stdout. */
export function jsonLine(line: string): any {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/** The core's environment without the Gemini key (the voice's key is never handed to a helper by accident). */
export function childEnv(): Record<string, string | undefined> {
  const { GEMINI_API_KEY: _k1, GOOGLE_API_KEY: _k2, ...env } = process.env;
  return env;
}

/** Find the binary, or undefined if it is not there. */
export function findBin(bin: string): string | undefined {
  if (bin.includes("/")) return existsSync(bin) ? bin : undefined;
  return Bun.which(bin) ?? undefined;
}

/** Run a quick check command (a CLI's own "am I signed in?"). True when it exits 0. */
export async function checkExitsZero(argv: string[], timeoutMs = 15000): Promise<boolean> {
  try {
    const proc = Bun.spawn(argv, { env: childEnv(), stdin: "ignore", stdout: "ignore", stderr: "ignore", timeout: timeoutMs });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

/**
 * Installed and signed in? For CLIs with their own sign-in (Codex, Claude Code):
 * `bin` is looked up, then `bin ...checkArgs` must exit 0 (no model call).
 */
export async function signInStatus(
  binName: string,
  checkArgs: string[],
  fix: { install: string; signIn: string },
): Promise<HelperStatus> {
  const bin = findBin(binName);
  if (!bin) return { ok: false, installed: false, fix: fix.install };
  return (await checkExitsZero([bin, ...checkArgs]))
    ? { ok: true, installed: true, bin }
    : { ok: false, installed: true, bin, fix: fix.signIn };
}

const MAX_SUMMARY = 2000;

/** The job's summary for the board and the voice: trimmed and capped. */
export function capSummary(text: string, fallback: string): string {
  const summary = text.trim() || fallback;
  return summary.length > MAX_SUMMARY ? `${summary.slice(0, MAX_SUMMARY)}...` : summary;
}

const MAX_TITLE = 48;
const MAX_LINE = 120;

/** Cut at a word boundary to at most `max` characters, with "…" when cut. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`;
}

/** The first sentence of one line (up to `. `, `? ` or `! `). */
const firstSentence = (line: string) => line.match(/^.*?[.?!](?=\s|$)/)?.[0] ?? line;

/**
 * A job card's title made from the task (ticket 29), when the model gave none:
 * its first sentence, without "please" / "can you", at most 48 characters.
 * "Can you check git status? Then tell me." -> "check git status"
 */
export function shortTitle(task: string): string {
  const line = task.trim().split(/\r?\n/)[0] ?? "";
  const sentence = firstSentence(line)
    .replace(/^(please|pls|hey|ok(ay)?|so)[,\s]+/i, "")
    .replace(/^(can|could|would|will) you( please)?\s+/i, "")
    .replace(/^please\s+/i, "")
    .replace(/[.?!\s]+$/, "")
    .trim();
  return clip(sentence, MAX_TITLE) || "helper job";
}

/**
 * The one-line plain summary of a job's output for its card (ticket 29): the
 * first sentence of the first line that is not a heading, markdown marks
 * stripped, at most 120 characters. "" for no output.
 */
export function oneLine(text: string): string {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const line = lines.find((l) => !l.startsWith("#")) ?? lines[0] ?? "";
  const plain = line
    .replace(/^#+\s*/, "")
    .replace(/^([-*+>]|\d+[.)])\s+/, "")
    .replace(/[*_`]+/g, "")
    .trim();
  return clip(firstSentence(plain), MAX_LINE);
}
