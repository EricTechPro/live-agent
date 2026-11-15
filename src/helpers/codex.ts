// Helper adapter: run OpenAI's Codex CLI headless as a background job (ticket 18).
//
//   jobs.submit(codexJob({ task: "fix the failing test", cwd: "/path/to/project" }));
//
// What it runs (cwd = the project folder, or its worktree):
//   codex exec --json --sandbox workspace-write --skip-git-repo-check -- "<task>"
// - exec: non-interactive; it never asks for approval, it just runs.
// - --sandbox workspace-write: Codex may edit files and run commands inside the
//   folder; the OS sandbox blocks writes elsewhere. Our own safety gate already
//   asked the user before a helper starts (helper risk).
// - --skip-git-repo-check: with worktrees off the folder may not be a git repo.
// - --json: one event per line; the summary is the last `agent_message`.
// - Auth: the user's own Codex sign-in (`codex login`, ChatGPT or an OpenAI key).
//   live-agent never signs in for them and never passes on the Gemini key.
// - Ready check: `codex login status` exits 0 when signed in (no model call).
import type { JobSpec } from "../core/jobs.ts";
import { capSummary, checkExitsZero, childEnv, findBin, jobTitle, jsonLine, runCli, type HelperPaths } from "./cli-job.ts";
import type { HelperStatus } from "./index.ts";

export const DEFAULT_CODEX_BIN = "codex";
export const CODEX_INSTALL_FIX = "Codex is not installed. Install it with: npm install -g @openai/codex";
export const CODEX_SIGN_IN_FIX = 'Codex is not signed in. Run "codex login" once in a terminal.';

const SIGNED_OUT = /\b401\b|\bunauthori[sz]ed\b|not logged in|not signed in|please (log|sign) in|codex login/i;

export async function codexStatus({ codexBin = DEFAULT_CODEX_BIN }: HelperPaths = {}): Promise<HelperStatus> {
  const bin = findBin(codexBin);
  if (!bin) return { ok: false, installed: false, fix: CODEX_INSTALL_FIX };
  return (await checkExitsZero([bin, "login", "status"]))
    ? { ok: true, installed: true, bin }
    : { ok: false, installed: true, bin, fix: CODEX_SIGN_IN_FIX };
}

export function codexJob({ task, cwd, cancelGraceMs = 3000, ...paths }: HelperPaths & { task: string; cwd: string }): JobSpec {
  return {
    kind: "codex",
    title: jobTitle(task),
    async run({ signal }) {
      const status = await codexStatus(paths);
      if (!status.ok) throw new Error(status.fix);
      let said = "";
      let error: string | undefined;
      const r = await runCli({
        argv: [status.bin!, "exec", "--json", "--sandbox", "workspace-write", "--skip-git-repo-check", "--color", "never", "--", task],
        cwd,
        env: childEnv(),
        signal,
        cancelGraceMs,
        onLine(line) {
          const ev = jsonLine(line);
          if (ev?.type === "item.completed" && ev.item?.type === "agent_message" && typeof ev.item.text === "string") said = ev.item.text;
          if (ev?.type === "turn.failed") error = ev.error?.message ?? "Codex reported an error";
          if (ev?.type === "error" && typeof ev.message === "string") error = ev.message;
        },
      });
      if (r === "cancelled") return "cancelled";
      if (r.code !== 0 || error) {
        // API errors arrive as a JSON string inside the message: keep just the words.
        const api = jsonLine(error ?? "")?.error;
        const why = typeof api?.message === "string" ? api.message : (error ?? r.stderrTail);
        if (api?.code === "model_not_found") {
          throw new Error(`Codex: ${why} Fix: set a model your account can use as "model" in ~/.codex/config.toml.`);
        }
        // Real sign-in errors only: a task's own words ("fix the login form") are not one.
        if (SIGNED_OUT.test(why)) throw new Error(CODEX_SIGN_IN_FIX);
        throw new Error(`Codex stopped with exit code ${r.code}${why ? `: ${why}` : ""}`);
      }
      return capSummary(said, "Codex finished without a reply.");
    },
  };
}
