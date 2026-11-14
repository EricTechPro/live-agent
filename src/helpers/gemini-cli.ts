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
// - Our GEMINI_API_KEY / GOOGLE_API_KEY are not passed on: with them Gemini CLI
//   would bill the user's key instead of their free Google sign-in.
// - Spawned in its own process group, so cancel stops the CLI and everything it
//   started (shell commands, MCP servers).
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { JobSpec } from "../core/jobs.ts";

export const INSTALL_FIX = "Gemini CLI is not installed. Install it with: npm install -g @google/gemini-cli";
export const SIGN_IN_FIX =
  "Gemini CLI isn't signed in. Run `gemini` once in a terminal and choose Login with Google.";

export interface GeminiCliOptions {
  /** What the helper should do, in plain words. */
  task: string;
  /** The project folder the helper works in. */
  cwd: string;
  /** The Gemini CLI binary: a name on PATH or a path. Default "gemini". Tests point it at a fake script. */
  bin?: string;
  /** Where Gemini CLI keeps `.gemini/` (its GEMINI_CLI_HOME). Default: the user's home. */
  home?: string;
  /** How long to wait after SIGINT before SIGKILL on cancel. Default 3000 ms. */
  cancelGraceMs?: number;
}

/** Find the binary, or undefined if it is not there. */
export function findGeminiCli(bin = "gemini"): string | undefined {
  if (bin.includes("/")) return existsSync(bin) ? bin : undefined;
  return Bun.which(bin) ?? undefined;
}

export type GeminiCliStatus =
  | { ok: true; installed: true; bin: string }
  | { ok: false; installed: true; bin: string; fix: string }
  | { ok: false; installed: false; fix: string };

/**
 * Installed and signed in? Cheap: no network, no model call (the doctor uses it too).
 * A heuristic from `~/.gemini`: the real answer is exit code 41 at run time,
 * which maps to the same fix.
 */
export function geminiCliStatus({ bin = "gemini", home }: { bin?: string; home?: string } = {}): GeminiCliStatus {
  const path = findGeminiCli(bin);
  if (!path) return { ok: false, installed: false, fix: INSTALL_FIX };
  const dir = join(home ?? process.env.GEMINI_CLI_HOME ?? homedir(), ".gemini");
  let selected: string | undefined;
  try {
    selected = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"))?.security?.auth?.selectedType;
  } catch {}
  const oauth = existsSync(join(dir, "oauth_creds.json"));
  // Our API key is never passed to the helper, so it does not count as signed in.
  const signedIn = selected
    ? selected !== "oauth-personal" || oauth
    : oauth || process.env.GOOGLE_GENAI_USE_GCA === "true";
  return signedIn ? { ok: true, installed: true, bin: path } : { ok: false, installed: true, bin: path, fix: SIGN_IN_FIX };
}

const MAX_SUMMARY = 2000;

export function geminiCliJob({ task, cwd, bin = "gemini", home, cancelGraceMs = 3000 }: GeminiCliOptions): JobSpec {
  return {
    kind: "gemini-cli",
    title: task.length > 80 ? `${task.slice(0, 77)}...` : task,
    async run({ signal }) {
      const status = geminiCliStatus({ bin, home });
      if (!status.ok) throw new Error(status.fix);
      const path = status.bin;

      const { GEMINI_API_KEY: _k1, GOOGLE_API_KEY: _k2, ...env } = process.env;
      if (home) env.GEMINI_CLI_HOME = home;
      const proc = Bun.spawn(
        [path, "-p", task, "--output-format", "stream-json", "--approval-mode", "yolo", "--skip-trust"],
        {
          cwd,
          env: { ...env, GEMINI_CLI_TRUST_WORKSPACE: "true" },
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

      try {
        const stderr = new Response(proc.stderr).text();
        const { said, error } = await readStream(proc.stdout);
        const code = await proc.exited;
        // The shell may be gone while children it left behind still hold the group.
        if (signal.aborted) group("SIGKILL");
        if (signal.aborted) return "cancelled";
        if (code === 41) throw new Error(SIGN_IN_FIX);
        if (code === 52) throw new Error("Gemini CLI settings are broken: check ~/.gemini/settings.json");
        if (code !== 0 || error) {
          const tail = (await stderr).trim().split("\n").slice(-5).join("\n");
          throw new Error(error ?? `Gemini CLI stopped with exit code ${code}${tail ? `: ${tail}` : ""}`);
        }
        const summary = said.trim() || "Gemini CLI finished without a reply.";
        return summary.length > MAX_SUMMARY ? `${summary.slice(0, MAX_SUMMARY)}...` : summary;
      } finally {
        signal.removeEventListener("abort", onAbort);
        clearTimeout(killTimer);
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
