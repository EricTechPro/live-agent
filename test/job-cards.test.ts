// Ticket 29: what a readable job card needs, on the core's `job.state` events.
// Through the event stream, with the scripted fake model and a fake helper CLI.
import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/config/index.ts";
import { geminiOnly } from "./gemini-only.ts";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent, EventOf } from "../src/core/events.ts";
import { createJobs } from "../src/core/jobs.ts";
import { loadTools } from "../src/core/registry.ts";
import { oneLine, shortTitle } from "../src/helpers/cli-job.ts";
import { scriptedModel } from "../src/models/scripted.ts";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "live-agent-job-cards-")));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const tools = await loadTools();

const answer = "## Done\n\nFixed the flaky login test. The retry now waits for the token.\nAlso bumped the timeout to 5s.";
const cli = join(dir, "cli.sh");
writeFileSync(cli, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({ type: "message", role: "assistant", content: answer })}'\n`);
chmodSync(cli, 0o755);
const failing = join(dir, "fail.sh");
writeFileSync(failing, `#!/bin/sh\necho "boom: tests are red. Run bun test to see which." >&2\nexit 3\n`);
chmodSync(failing, 0o755);

async function run(args: Record<string, unknown>, bin = cli) {
  const s = await startSession({
    model: scriptedModel([[{ type: "tool.call", id: "c1", name: "start_helper", args }], [{ type: "text", text: "Started." }], [{ type: "text", text: "Done." }]]),
    tools, mode: "bypass", workDir: dir, config: { ...geminiOnly(defaultConfig()), brainPath: dir, worktrees: false },
    helpers: { geminiCliBin: bin, geminiCliHome: join(dir, "cli-home"), geminiApiKey: "k" },
  });
  const states: EventOf<"job.state">[] = [];
  let ended: () => void = () => {};
  const end = new Promise<void>((done) => (ended = done));
  s.onEvent((e: AgentEvent) => {
    if (e.type !== "job.state") return;
    states.push(e);
    if (["done", "failed", "cancelled"].includes(e.state)) ended();
  });
  await s.sendText("Fix the login test.");
  await end;
  await s.close();
  return states;
}

test("job.state carries the helper id, start and end times, and on done a one-line summary plus the full output", async () => {
  const before = Date.now();
  const states = await run({ task: "please fix the flaky login test in the auth folder, then run all the tests again and tell me", title: "Fix flaky login test" });
  const [queued, running, done] = states;
  expect(states.map((e) => e.state)).toEqual(["queued", "running", "done"]);
  for (const e of states) expect(e).toMatchObject({ kind: "gemini-cli", title: "Fix flaky login test" });
  expect(queued!.startedAt).toBeUndefined();
  expect(running!.startedAt).toBeGreaterThanOrEqual(before);
  expect(running!.endedAt).toBeUndefined();
  expect(done!.startedAt).toBe(running!.startedAt!);
  expect(done!.endedAt).toBeGreaterThanOrEqual(done!.startedAt!);
  expect(done!.summary).toBe("Fixed the flaky login test.");
  expect(done!.output).toBe(answer);
});

test("without a title, the core makes a short one from the task", async () => {
  const states = await run({ task: "Please fix the flaky login test in the auth folder, then run all the tests again and tell me how it went." });
  expect(states[0]!.title).toBe("fix the flaky login test in the auth folder…");
  expect(states[0]!.title.length).toBeLessThanOrEqual(48);
});

test("a failed job carries the fix as its one-line summary and the whole error as output", async () => {
  const states = await run({ task: "fix it" }, failing);
  const failed = states.at(-1)!;
  expect(failed.state).toBe("failed");
  expect(failed.summary).toBe("Gemini CLI stopped with exit code 3: boom: tests are red.");
  expect(failed.output).toContain("Run bun test to see which.");
  expect(failed.endedAt).toBeGreaterThanOrEqual(failed.startedAt!);
});

test("the full output is capped", async () => {
  const seen: AgentEvent[] = [];
  const jobs = createJobs({ maxAtOnce: 1, onState: (job) => seen.push({ type: "job.state", ...job }) });
  jobs.submit({ kind: "tidy", title: "tidy", run: async () => "x".repeat(50_000) });
  await new Promise((r) => setTimeout(r, 20));
  const done = seen.at(-1) as EventOf<"job.state">;
  expect(done.state).toBe("done");
  expect(done.output!.length).toBeLessThanOrEqual(8_001);
});

test("short titles and one-line summaries", () => {
  expect(shortTitle("fix the bug")).toBe("fix the bug");
  expect(shortTitle("Can you check git status? Then tell me.")).toBe("check git status");
  expect(shortTitle("  ")).toBe("helper job");
  expect(oneLine("# Title\n\n- **Fixed** the `bug`.\nMore.")).toBe("Fixed the bug.");
  expect(oneLine("")).toBe("");
  expect(oneLine("word ".repeat(60)).length).toBeLessThanOrEqual(120);
});
