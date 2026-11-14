// Helper adapter: run Gemini CLI headless as a background job.
//
//   jobs.submit(geminiCliJob({ task: "fix the failing test", cwd: "/path/to/project" }));
//
// What it runs:
//   gemini -p "<task>" --output-format stream-json --approval-mode yolo --skip-trust
// - yolo: headless Gemini CLI denies any tool call that needs approval, so
//   without it the helper could not edit anything. Our own safety gate already
//   asked the user before a helper starts (helper risk).
// - --skip-trust: an untrusted folder would make headless mode exit at once.
// - Auth: the same Gemini API key as the voice (Google ended Gemini CLI's free
//   "Login with Google" tier for this kind of client). It goes in as
//   GEMINI_API_KEY only: with GOOGLE_API_KEY set too, the CLI prints a warning.
// - A private CLI home owned by live-agent (GEMINI_CLI_HOME, default under the
//   OS app-data folder) whose `.gemini/settings.json` selects API-key auth, so
//   the user's own `gemini` login and settings are never read or touched.
//   HOME itself is left alone, so git and the project behave as usual.
// - Spawned in its own process group, so cancel stops the CLI and everything it
//   started (shell commands, MCP servers).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { JobSpec } from "../core/jobs.ts";
import { watchGroup } from "./group-watchdog.ts";
import { geminiApiKey } from "../gemini-key.ts";

const KEY_GUIDE = "README.md#get-your-gemini-key";
export const INSTALL_FIX = "Gemini CLI is not installed. Install it with: npm install -g @google/gemini-cli";
export const KEY_FIX = `The helper needs a Gemini key. Put GEMINI_API_KEY in your .env file. How to get one: ${KEY_GUIDE}`;
export const KEY_REJECTED_FIX = `Gemini CLI rejected the Gemini key. Check GEMINI_API_KEY in your .env file. How to get one: ${KEY_GUIDE}`;

/** The Gemini CLI binary looked up on PATH unless told otherwise. */
export const DEFAULT_GEMINI_BIN = "gemini";

/**
 * Where the helper CLI lives and what it runs on. One shape all the way down:
 * the session options, the tool context and this adapter all take it as is
 * (tests point it at a fake CLI script).
 */
export interface HelperPaths {
  /** The Gemini CLI binary: a name on PATH or a path. Default "gemini". */
  geminiCliBin?: string;
  /** live-agent's private Gemini CLI home (its GEMINI_CLI_HOME). Default: `defaultHelperHome()`. */
  geminiCliHome?: string;
  /** The Gemini API key. Default: `geminiApiKey()` (the same key as the voice). */
  geminiApiKey?: string;
  /** How long to wait after SIGINT before SIGKILL on cancel. Default 3000 ms. */
  cancelGraceMs?: number;
}

export interface GeminiCliOptions extends HelperPaths {
  /** What the helper should do, in plain words. */
  task: string;
  /** The project folder the helper works in. */
  cwd: string;
}

/** live-agent's own folder for the helper's Gemini CLI home (in the OS app-data folder). */
export function defaultHelperHome(): string {
  const home = homedir();
  const base =
    process.platform === "darwin"
      ? join(home, "Library", "Application Support")
      : process.platform === "win32"
        ? (process.env.APPDATA ?? join(home, "AppData", "Roaming"))
        : (process.env.XDG_DATA_HOME ?? join(home, ".local", "share"));
  return join(base, "live-agent", "gemini-cli");
}

/** Make sure the private home's settings select API-key auth (any other settings in it are kept). */
function prepareHome(home: string) {
  const dir = join(home, ".gemini");
  const file = join(dir, "settings.json");
  let settings: any = {};
  try {
    settings = JSON.parse(readFileSync(file, "utf8")) ?? {};
  } catch {}
  if (settings?.security?.auth?.selectedType === "gemini-api-key") return;
  settings.security = { ...settings.security, auth: { ...settings.security?.auth, selectedType: "gemini-api-key" } };
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}

/** Find the binary, or undefined if it is not there. */
export function findGeminiCli(bin = DEFAULT_GEMINI_BIN): string | undefined {
  if (bin.includes("/")) return existsSync(bin) ? bin : undefined;
  return Bun.which(bin) ?? undefined;
}

export type GeminiCliStatus =
  | { ok: true; installed: true; bin: string }
  | { ok: false; installed: true; bin: string; fix: string }
  | { ok: false; installed: false; fix: string };

/**
 * Installed and a key present? Cheap: no network, no model call (the doctor uses it too).
 * Whether Google accepts the key shows at run time as exit code 41.
 */
export function geminiCliStatus({ bin = DEFAULT_GEMINI_BIN, apiKey = geminiApiKey() }: { bin?: string; apiKey?: string } = {}): GeminiCliStatus {
  const path = findGeminiCli(bin);
  if (!path) return { ok: false, installed: false, fix: INSTALL_FIX };
  return apiKey ? { ok: true, installed: true, bin: path } : { ok: false, installed: true, bin: path, fix: KEY_FIX };
}

const MAX_SUMMARY = 2000;

export function geminiCliJob({
  task,
  cwd,
  geminiCliBin: bin = DEFAULT_GEMINI_BIN,
  geminiCliHome: home = defaultHelperHome(),
  geminiApiKey: apiKey = geminiApiKey(),
  cancelGraceMs = 3000,
}: GeminiCliOptions): JobSpec {
  return {
    kind: "gemini-cli",
    title: task.length > 80 ? `${task.slice(0, 77)}...` : task,
    async run({ signal }) {
      const status = geminiCliStatus({ bin, apiKey });
      if (!status.ok) throw new Error(status.fix);
      const path = status.bin;
      prepareHome(home);

      const { GEMINI_API_KEY: _k1, GOOGLE_API_KEY: _k2, GEMINI_CLI_HOME: _h, ...env } = process.env;
      const proc = Bun.spawn(
        [path, "-p", task, "--output-format", "stream-json", "--approval-mode", "yolo", "--skip-trust"],
        {
          cwd,
          env: { ...env, GEMINI_API_KEY: apiKey, GEMINI_CLI_HOME: home, GEMINI_CLI_TRUST_WORKSPACE: "true" },
          // -p appends stdin to the prompt, so give it none.
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          detached: true,
        },
      );

      // Cancel: SIGINT the whole group (the CLI exits cleanly), SIGKILL it if it lingers.
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
      // If the core is killed hard, the watchdog stops the group (src/helpers/group-watchdog.ts).
      const stopWatch = watchGroup(proc.pid);

      try {
        const stderr = new Response(proc.stderr).text();
        const { said, error } = await readStream(proc.stdout);
        const code = await proc.exited;
        // The shell may be gone while children it left behind still hold the group.
        if (signal.aborted) group("SIGKILL");
        if (signal.aborted) return "cancelled";
        if (code === 41) throw new Error(KEY_REJECTED_FIX);
        if (code === 52) throw new Error(`Gemini CLI settings are broken: check ${join(home, ".gemini", "settings.json")}`);
        if (code !== 0 || error) {
          const tail = (await stderr).trim().split("\n").slice(-5).join("\n");
          throw new Error(error ?? `Gemini CLI stopped with exit code ${code}${tail ? `: ${tail}` : ""}`);
        }
        const summary = said.trim() || "Gemini CLI finished without a reply.";
        return summary.length > MAX_SUMMARY ? `${summary.slice(0, MAX_SUMMARY)}...` : summary;
      } finally {
        signal.removeEventListener("abort", onAbort);
        clearTimeout(killTimer);
        stopWatch();
      }
    },
  };
}

// Read stream-json (one JSON event per line). Lines that are not JSON are
// warnings that leaked to stdout: skip them.
async function readStream(stdout: ReadableStream<Uint8Array>) {
  let said = "";
  let error: string | undefined;
  let buf = "";
  const handle = (line: string) => {
    let ev: any;
    try {
      ev = JSON.parse(line);
    } catch {
      return;
    }
    if (ev?.type === "message" && ev.role === "assistant" && typeof ev.content === "string") said += ev.content;
    if (ev?.type === "result" && ev.status === "error") error = ev.error?.message ?? "Gemini CLI reported an error";
  };
  const decoder = new TextDecoder();
  for await (const chunk of stdout) {
    buf += decoder.decode(chunk, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      handle(buf.slice(0, i));
      buf = buf.slice(i + 1);
    }
  }
  if (buf.trim()) handle(buf);
  return { said, error };
}
