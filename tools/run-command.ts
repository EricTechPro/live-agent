// run_command: run one shell command in the work folder and answer its output.
// Risk "command": Ask first and Auto ask every time; only Full access runs it straight away.
// For bigger jobs (code, many steps) start_helper is still the way.
import { defineTool } from "../src/core/tool.ts";

const MAX_OUT = 8000;
const clip = (s: string) => (s.length > MAX_OUT ? `${s.slice(0, MAX_OUT)}\n...(cut, ${s.length - MAX_OUT} more characters)` : s);

export default defineTool<{ command: string; timeoutSeconds?: number }>({
  name: "run_command",
  description:
    "Run one short shell command (zsh) on the user's Mac in the work folder and get its output: quick checks like " +
    "'ls ~/Downloads', 'git status', 'df -h', 'mdfind -name invoice'. Not for long or multi-step work: use start_helper.",
  risk: "command",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The command line." },
      timeoutSeconds: { type: "integer", description: "Stop it after this long (default 30, at most 120)." },
    },
    required: ["command"],
  },
  async run({ command, timeoutSeconds }, { workDir }) {
    const cmd = String(command ?? "").trim();
    if (!cmd) throw new Error("Say which command to run.");
    const limit = Math.min(120, Math.max(1, Number(timeoutSeconds) || 30)) * 1000;
    const proc = Bun.spawn(["/bin/zsh", "-c", cmd], { cwd: workDir, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, limit);
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { exitCode, stdout: clip(stdout), stderr: clip(stderr), ...(timedOut ? { timedOut: true } : {}) };
    } finally {
      clearTimeout(timer);
    }
  },
});
