// Live smoke for the Codex and Claude Code helpers (ticket 18): real Gemini Live
// as the boss, the real CLI as the helper, one tiny job each in a temp git repo
// with worktrees on. Each case runs only if that CLI says it is installed and
// signed in; it never signs in for you. Costs a little of your Codex / Claude usage.
//
//   bun test ./smoke/helpers-smoke.test.ts
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/config/index.ts";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent, EventOf } from "../src/core/events.ts";
import { geminiApiKey } from "../src/gemini-key.ts";
import { claudeCodeStatus } from "../src/helpers/claude-code.ts";
import { codexStatus } from "../src/helpers/codex.ts";
import { geminiLiveModel } from "../src/models/gemini-live.ts";

const apiKey = geminiApiKey();
const cases = [
  { id: "codex", say: "Codex", key: "codex", ready: (await codexStatus({ codexBin: process.env.SMOKE_CODEX_BIN })).ok },
  { id: "claude-code", say: "Claude Code", key: "claudeCode", ready: (await claudeCodeStatus()).ok },
] as const;

for (const c of cases) {
  if (apiKey && !c.ready) console.log(`helpers smoke: ${c.say} skipped (not installed or not signed in)`);
  test.skipIf(!apiKey || !c.ready)(
    `the user names ${c.say}, and it fixes an off-by-one bug on its own worktree branch`,
    async () => {
      const dir = mkdtempSync(join(tmpdir(), `live-agent-smoke-${c.id}-`));
      const project = join(dir, "counter-app");
      mkdirSync(project);
      writeFileSync(
        join(project, "counter.js"),
        "// Counts from 1 to n, inclusive.\nexport function countTo(n) {\n  const out = [];\n  for (let i = 1; i < n; i++) out.push(i);\n  return out;\n}\n",
      );
      for (const args of [["init", "-q"], ["add", "."], ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "start"]]) {
        Bun.spawnSync(["git", ...args], { cwd: project });
      }
      const config = defaultConfig();
      config.helpers = { ...config.helpers, geminiCli: false, [c.key]: true };
      config.worktrees = true;
      const session = await startSession({
        model: geminiLiveModel({ apiKey: apiKey! }), workDir: project, mode: "bypass", config, chatEndNote: false,
        // SMOKE_CODEX_BIN: a wrapper, e.g. to pass `-c model=...` without touching ~/.codex/config.toml.
        helpers: { worktreesRoot: join(dir, "worktrees"), codexBin: process.env.SMOKE_CODEX_BIN },
      });
      const all: AgentEvent[] = [];
      session.onEvent((e) => all.push(e));
      try {
        const events = await session.sendText(
          `Use ${c.say} to fix the off-by-one bug in counter.js in this project: countTo(3) must return [1, 2, 3]. Tell me when it is done.`,
        );
        expect(events).toContainEqual(expect.objectContaining({ type: "tool.call", name: "start_helper" }));
        const end = () =>
          all.find((e): e is EventOf<"job.state"> => e.type === "job.state" && ["done", "failed", "cancelled"].includes(e.state));
        const deadline = Date.now() + 280_000;
        while (!end() && Date.now() < deadline) await Bun.sleep(500);
        await Bun.sleep(4000); // let the announcement come
        const job = end()!;
        console.log(`  ${c.say}:`, { kind: job?.kind, state: job?.state, message: job?.message, worktree: job?.worktree });
        console.log("  announced:", all.filter((e) => e.type === "transcript" && e.role === "model").map((e) => (e as any).text).join("").slice(-300));

        expect(job).toMatchObject({ kind: c.id, state: "done" });
        const { countTo } = await import(join(job.worktree!.path, "counter.js"));
        expect(countTo(3)).toEqual([1, 2, 3]);
        // The user's checkout is untouched.
        const { countTo: original } = await import(join(project, "counter.js"));
        expect(original(3)).toEqual([1, 2]);
      } finally {
        await session.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
    320_000,
  );
}
