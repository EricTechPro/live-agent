// Helper adapter: run Anthropic's Claude Code CLI headless as a background job (ticket 18).
//
//   jobs.submit(claudeCodeJob({ task: "fix the failing test", cwd: "/path/to/project" }));
//
// What it runs (cwd = the project folder, or its worktree):
//   claude -p "<task>" --output-format json --permission-mode bypassPermissions --no-session-persistence
// - -p: print mode, one task then exit. Nobody can answer a permission prompt
//   there (it would be refused), so the helper needs a mode that does not ask.
// - bypassPermissions: edits and commands run, like Gemini CLI's yolo. Our own
//   safety gate already asked the user before a helper starts (helper risk).
// - --output-format json: one result object; `result` is the summary,
//   `is_error` says it failed.
// - --no-session-persistence: helper runs do not fill the user's /resume list.
// - Auth: the user's own Claude Code sign-in (`claude auth login`, or their
//   ANTHROPIC_API_KEY). live-agent never signs in for them and never passes on
//   the Gemini key.
// - Ready check: `claude auth status` exits 0 when signed in (no model call).
import type { JobSpec } from "../core/jobs.ts";
import type { HelperPaths } from "./gemini-cli.ts";
import { capSummary, checkExitsZero, childEnv, findBin, jobTitle, jsonLine, runCli } from "./cli-job.ts";
import type { HelperStatus } from "./index.ts";

export const DEFAULT_CLAUDE_CODE_BIN = "claude";
export const CLAUDE_CODE_INSTALL_FIX = "Claude Code is not installed. Install it with: npm install -g @anthropic-ai/claude-code";
export const CLAUDE_CODE_SIGN_IN_FIX = 'Claude Code is not signed in. Run "claude auth login" once in a terminal.';

// If live-agent itself was started from a Claude Code session, its CLAUDECODE /
// CLAUDE_CODE_* variables would tie the helper to that session. The helper is
// its own session: drop them (ANTHROPIC_* sign-in variables stay).
function standaloneEnv() {
  return Object.fromEntries(
    Object.entries(childEnv()).filter(([k]) => k !== "CLAUDECODE" && k !== "CLAUDE_PID" && !k.startsWith("CLAUDE_CODE_")),
  );
}

export async function claudeCodeStatus({ claudeCodeBin = DEFAULT_CLAUDE_CODE_BIN }: HelperPaths = {}): Promise<HelperStatus> {
  const bin = findBin(claudeCodeBin);
  if (!bin) return { ok: false, installed: false, fix: CLAUDE_CODE_INSTALL_FIX };
  return (await checkExitsZero([bin, "auth", "status"]))
    ? { ok: true, installed: true, bin }
    : { ok: false, installed: true, bin, fix: CLAUDE_CODE_SIGN_IN_FIX };
}

export function claudeCodeJob({ task, cwd, cancelGraceMs = 3000, ...paths }: HelperPaths & { task: string; cwd: string }): JobSpec {
  return {
    kind: "claude-code",
    title: jobTitle(task),
    async run({ signal }) {
      const status = await claudeCodeStatus(paths);
      if (!status.ok) throw new Error(status.fix);
      let result: any;
      const r = await runCli({
        argv: [
          status.bin!, "-p", task, "--output-format", "json", "--permission-mode", "bypassPermissions", "--no-session-persistence",
        ],
        cwd,
        env: standaloneEnv(),
        signal,
        cancelGraceMs,
        onLine(line) {
          const ev = jsonLine(line);
          if (ev?.type === "result") result = ev;
        },
      });
      if (r === "cancelled") return "cancelled";
      const text = typeof result?.result === "string" ? result.result : "";
      if (r.code !== 0 || result?.is_error) {
        const why = text || r.stderrTail;
        if (/not logged in|\/login|invalid api key|authenticat/i.test(why)) throw new Error(CLAUDE_CODE_SIGN_IN_FIX);
        throw new Error(`Claude Code stopped with exit code ${r.code}${why ? `: ${why}` : ""}`);
      }
      return capSummary(text, "Claude Code finished without a reply.");
    },
  };
}
