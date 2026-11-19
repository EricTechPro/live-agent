// The workflow tools, write_file, the session's scheduler and the catalog in the
// system prompt, through the agent core's event stream (scripted fake model,
// a fake Gemini CLI that notes its task).
import { afterAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, type Config, type SafetyMode } from "../src/config/index.ts";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent, EventOf } from "../src/core/events.ts";
import type { ConnectOptions, Model, ModelEvent, ModelInput } from "../src/core/model.ts";
import { loadTools } from "../src/core/registry.ts";
import { scriptedModel } from "../src/models/scripted.ts";
import { saveWorkflow, skillsDir, workflowsDir } from "../src/workflows/index.ts";
import { geminiOnly } from "./gemini-only.ts";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "live-agent-workflow-tools-")));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const tools = await loadTools();

const cli = join(dir, "gemini.sh");
// Notes the task (-p "<task>") it got, then answers like Gemini CLI's stream-json.
writeFileSync(cli, `#!/bin/sh\nprintf '%s' "$2" > "${dir}/task"\necho '{"type":"message","role":"assistant","content":"Done."}'\necho '{"type":"result","status":"success","stats":{"total_tokens":42}}'\n`);
chmodSync(cli, 0o755);

let n = 0;
function places() {
  const home = join(dir, `home-${n}`);
  const brain = join(dir, `brain-${n++}`);
  mkdirSync(home);
  mkdirSync(brain);
  return { home, brain };
}

const call = (name: string, args: Record<string, unknown>): ModelEvent[] => [{ type: "tool.call", id: `c-${name}`, name, args }];
const say = (text: string): ModelEvent[] => [{ type: "text", text }];
const result = (events: AgentEvent[], name: string) =>
  events.find((e): e is EventOf<"tool.result"> => e.type === "tool.result" && e.name === name)!;

async function session(
  where: { home: string; brain: string },
  script: ModelEvent[][],
  extra: { mode?: SafetyMode; model?: Model; schedule?: { tickMs?: number; now?: () => Date }; config?: Partial<Config> } = {},
) {
  return startSession({
    model: extra.model ?? scriptedModel(script),
    tools,
    mode: extra.mode ?? "bypass",
    workDir: where.home,
    config: { ...geminiOnly(defaultConfig()), brainPath: where.brain, worktrees: false, ...extra.config },
    helpers: { geminiCliBin: cli, geminiCliHome: join(dir, "cli-home"), geminiApiKey: "k" },
    chatEndNote: false,
    ...(extra.schedule ? { schedule: extra.schedule } : {}),
  });
}

function jobEnd(s: { onEvent(l: (e: AgentEvent) => void): () => void }) {
  return new Promise<EventOf<"job.state">>((done) =>
    s.onEvent((e) => {
      if (e.type === "job.state" && ["done", "failed", "cancelled"].includes(e.state)) done(e);
    }),
  );
}

test("create_workflow writes the file; list_workflows reads it back", async () => {
  const where = places();
  const s = await session(where, [
    call("create_workflow", { name: "Morning News", description: "Sum up the news", schedule: "0 8 * * 1-5", instructions: "Find AI news." }),
    call("list_workflows", {}),
    say("Done."),
  ]);
  const events = await s.sendText("every weekday at 8, sum up the news");
  expect(result(events, "create_workflow")).toMatchObject({ status: "ok", output: { name: "morning-news" } });
  expect(existsSync(join(workflowsDir(where.home), "morning-news.md"))).toBe(true);
  expect(result(events, "list_workflows").output).toMatchObject({
    workflows: [{ name: "morning-news", description: "Sum up the news", trigger: "0 8 * * 1-5" }],
  });
  await s.close();
});

test("create_workflow refuses a schedule that is not cron and writes nothing", async () => {
  const where = places();
  const s = await session(where, [
    call("create_workflow", { name: "x", description: "d", schedule: "every day at 8", instructions: "i" }),
    say("Sorry."),
  ]);
  const events = await s.sendText("make it");
  expect(result(events, "create_workflow")).toMatchObject({ status: "error" });
  expect(result(events, "create_workflow").error).toMatch(/5 fields/);
  expect(existsSync(workflowsDir(where.home))).toBe(false);
  await s.close();
});

test("run_workflow starts its helper job in the brain with the instructions and the skills", async () => {
  const where = places();
  saveWorkflow(where.home, { name: "news", description: "d", trigger: "manual", instructions: "Find AI news." });
  mkdirSync(join(skillsDir(where.home), "digest"), { recursive: true });
  writeFileSync(join(skillsDir(where.home), "digest", "SKILL.md"), "---\nname: digest\ndescription: Write a digest\n---\nx\n");
  const s = await session(where, [call("run_workflow", { name: "news" }), say("Started."), say("Done.")]);
  const end = jobEnd(s);
  const events = await s.sendText("run the news workflow");
  expect(result(events, "run_workflow")).toMatchObject({ status: "ok", output: { name: "news", helper: "gemini-cli" } });
  const job = await end;
  expect(job).toMatchObject({ state: "done", title: "news", folder: where.brain });
  const task = readFileSync(join(dir, "task"), "utf8");
  expect(task.startsWith("Find AI news.")).toBe(true);
  expect(task).toContain("digest: Write a digest");
  await s.close();
});

test("run_workflow asks first in Ask me (helper risk)", async () => {
  const where = places();
  saveWorkflow(where.home, { name: "news", description: "d", trigger: "manual", instructions: "x" });
  const s = await session(where, [call("run_workflow", { name: "news" }), say("Waiting.")], { mode: "ask-me" });
  const events = await s.sendText("run news");
  expect(result(events, "run_workflow").status).toBe("waiting");
  await s.close();
});

test("delete_workflow removes the file", async () => {
  const where = places();
  saveWorkflow(where.home, { name: "news", description: "d", trigger: "manual", instructions: "x" });
  const s = await session(where, [call("delete_workflow", { name: "news" }), say("Gone.")]);
  const events = await s.sendText("delete news");
  expect(result(events, "delete_workflow")).toMatchObject({ status: "ok", output: { deleted: "news" } });
  expect(existsSync(join(workflowsDir(where.home), "news.md"))).toBe(false);
  await s.close();
});

test("write_file writes a text file inside the brain", async () => {
  const where = places();
  const s = await session(where, [call("write_file", { path: "projects/todo.md", content: "- milk\n" }), say("Saved.")]);
  const events = await s.sendText("note milk");
  expect(result(events, "write_file")).toMatchObject({ status: "ok", output: { path: "projects/todo.md" } });
  expect(readFileSync(join(where.brain, "projects", "todo.md"), "utf8")).toBe("- milk\n");
  expect(events.some((e) => e.type === "brain.write" && e.path === "projects/todo.md")).toBe(true);
  await s.close();
});

test("write_file refuses paths that leave the brain", async () => {
  const where = places();
  const outside = join(dir, "outside.md");
  const s = await session(where, [
    call("write_file", { path: "../outside.md", content: "x" }),
    call("write_file", { path: outside, content: "x" }),
    say("No."),
  ]);
  const events = await s.sendText("write outside");
  const results = events.filter((e): e is EventOf<"tool.result"> => e.type === "tool.result");
  expect(results.map((r) => r.status)).toEqual(["error", "error"]);
  expect(existsSync(outside)).toBe(false);
  await s.close();
});

test("the session's scheduler fires a due workflow with no approval, even in Ask me", async () => {
  const where = places();
  saveWorkflow(where.home, { name: "tick", description: "d", trigger: "* * * * *", instructions: "Scheduled run." });
  const s = await session(where, [], { mode: "ask-me", schedule: { tickMs: 5 } });
  const job = await jobEnd(s);
  expect(job).toMatchObject({ state: "done", title: "tick", kind: "gemini-cli" });
  expect(readFileSync(join(dir, "task"), "utf8")).toBe("Scheduled run.");
  await s.close();
});

test("a scheduled job counts its tokens and, mid-chat, is told to the model once it is idle", async () => {
  const where = places();
  saveWorkflow(where.home, { name: "tick", description: "d", trigger: "* * * * *", instructions: "Scheduled run." });
  const inputs: ModelInput[] = [];
  const model = scriptedModel([say("Hi."), say("Your tick workflow is done.")], { inputs });
  const s = await session(where, [], { model, schedule: { tickMs: 30 } });
  const end = jobEnd(s);
  const events: AgentEvent[] = [];
  s.onEvent((e) => events.push(e));
  await s.sendText("hi");
  const job = await end;
  expect(job).toMatchObject({ state: "done", title: "tick", tokens: 42 });
  const deadline = Date.now() + 2000;
  while (!events.some((e) => e.type === "turn.done" && e.reply.includes("tick workflow")) && Date.now() < deadline) await Bun.sleep(5);
  const notice = inputs.find((i) => i.type === "text" && i.text.startsWith("[Notice"));
  expect(notice).toMatchObject({ text: expect.stringContaining('"tick" finished: Done.') });
  // A notice is not the user talking: no user transcript for it.
  expect(events.filter((e) => e.type === "transcript" && e.role === "user").map((e) => (e as { text: string }).text)).toEqual(["hi"]);
  await s.close();
});

test("announceScheduled off: a scheduled job ends without a word to the model", async () => {
  const where = places();
  saveWorkflow(where.home, { name: "tick", description: "d", trigger: "* * * * *", instructions: "Scheduled run." });
  const inputs: ModelInput[] = [];
  const model = scriptedModel([say("Hi.")], { inputs });
  const s = await session(where, [], { model, schedule: { tickMs: 30 }, config: { announceScheduled: false } });
  const end = jobEnd(s);
  await s.sendText("hi");
  await end;
  await Bun.sleep(30);
  expect(inputs.filter((i) => i.type === "text").length).toBe(1);
  await s.close();
});

test("the system prompt lists workflows and skills and teaches the work rules", async () => {
  const where = places();
  saveWorkflow(where.home, { name: "news", description: "Sum up the news", trigger: "0 8 * * 1-5", instructions: "x" });
  let seen: ConnectOptions | undefined;
  const inner = scriptedModel([]);
  const model: Model = { connect: (onEvent, options) => ((seen = options), inner.connect(onEvent, options)) };
  const s = await session(where, [], { model });
  const prompt = seen?.systemInstruction ?? "";
  expect(prompt).toContain("- news: Sum up the news (0 8 * * 1-5)");
  for (const tool of ["create_workflow", "run_workflow", "write_file", "start_helper"]) expect(prompt).toContain(tool);
  await s.close();
});
