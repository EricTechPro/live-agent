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
import { watchGroup } from "./group-watchdog.ts";

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

const MAX_SUMMARY = 2000;

/** The job's summary for the board and the voice: trimmed and capped. */
export function capSummary(text: string, fallback: string): string {
  const summary = text.trim() || fallback;
  return summary.length > MAX_SUMMARY ? `${summary.slice(0, MAX_SUMMARY)}...` : summary;
}

/** A job title is one line for the board. */
export function jobTitle(task: string): string {
  return task.length > 80 ? `${task.slice(0, 77)}...` : task;
}
