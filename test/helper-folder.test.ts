// Ticket 21: helper jobs start in the brain folder, never in the app's home.
// Through the agent core's event stream, with the scripted fake model and a
// fake helper CLI that notes the folder it ran in.
import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/config/index.ts";
import { geminiOnly } from "./gemini-only.ts";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent, EventOf } from "../src/core/events.ts";
import type { ModelEvent } from "../src/core/model.ts";
import { loadTools } from "../src/core/registry.ts";
import { systemInstruction } from "../src/core/tone.ts";
import { scriptedModel, type ScriptEntry } from "../src/models/scripted.ts";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "live-agent-helper-folder-")));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const tools = await loadTools();

// The installed app: a home folder (config, key, logs) and a brain somewhere else.
const home = join(dir, "home");
const brain = join(dir, "brain");
mkdirSync(join(brain, "projects", "live-agent"), { recursive: true });
mkdirSync(home);
const elsewhere = join(dir, "elsewhere");
mkdirSync(elsewhere);

const cli = join(dir, "where.sh");
writeFileSync(cli, `#!/bin/sh\necho "$PWD" > "${dir}/where-cwd"\necho '{"type":"message","role":"assistant","content":"ok"}'\n`);
chmodSync(cli, 0o755);

const startHelper = (args: Record<string, unknown>): ModelEvent => ({
  type: "tool.call", id: "c1", name: "start_helper", args: { task: "check git status", ...args },
});
const say = (text: string): ModelEvent[] => [{ type: "text", text }];

async function run(args: Record<string, unknown>, script: ScriptEntry[] = [[startHelper(args)], say("Started."), say("Done.")]) {
  const config = { ...geminiOnly(defaultConfig()), brainPath: brain, worktrees: false };
  // workDir = the app's home, like the Tauri shell's `chdir` into LIVE_AGENT_HOME.
  const s = await startSession({
    model: scriptedModel(script), tools, mode: "bypass", workDir: home, config,
    helpers: { geminiCliBin: cli, geminiCliHome: join(dir, "cli-home"), geminiApiKey: "k" },
  });
  const all: AgentEvent[] = [];
  let ended: (e: EventOf<"job.state">) => void = () => {};
  const end = new Promise<EventOf<"job.state">>((done) => (ended = done));
  s.onEvent((e) => {
    all.push(e);
    if (e.type === "job.state" && ["done", "failed", "cancelled"].includes(e.state)) ended(e);
  });
  const events = await s.sendText("What's the git status?");
  return { s, all, events, end };
}

const ranIn = () => readFileSync(join(dir, "where-cwd"), "utf8").trim();

test("no folder: the job works in the brain folder, never the app's home", async () => {
  const { s, all, end } = await run({});
  expect((await end).state).toBe("done");
  expect(ranIn()).toBe(brain);
  // Every job.state event says where the job works.
  const states = all.filter((e): e is EventOf<"job.state"> => e.type === "job.state");
  expect(states.length).toBeGreaterThanOrEqual(3);
  for (const state of states) expect(state.folder).toBe(brain);
  await s.close();
});

test("a relative folder starts in the brain folder", async () => {
  const { s, end } = await run({ folder: "projects/live-agent" });
  expect((await end).folder).toBe(join(brain, "projects", "live-agent"));
  expect(ranIn()).toBe(join(brain, "projects", "live-agent"));
  await s.close();
});

test("an absolute folder is used as given", async () => {
  const { s, end } = await run({ folder: elsewhere });
  expect((await end).folder).toBe(elsewhere);
  expect(ranIn()).toBe(elsewhere);
  await s.close();
});

test("a folder that does not exist fails with a plain fix, and no job starts", async () => {
  const { s, events } = await run({ folder: "projects/nope" }, [[startHelper({ folder: "projects/nope" })], say("No such folder.")]);
  expect(events.some((e) => e.type === "job.state")).toBe(false);
  const result = events.find((e): e is EventOf<"tool.result"> => e.type === "tool.result" && e.id === "c1")!;
  expect(result.status).toBe("error");
  expect(result.error).toContain(join(brain, "projects", "nope"));
  expect(result.error).toContain("does not exist");
  expect(result.error).toContain("projects/<name>");
  await s.close();
});

test("the tool schema and the system prompt name the same default: the brain folder", () => {
  const tool = tools.find((t) => t.name === "start_helper")!;
  const folder = (tool.parameters as { properties: { folder: { description: string } } }).properties.folder.description;
  expect(folder).toContain("Default: the user's notes folder");
  expect(folder).toContain("Relative paths start in the notes folder");
  expect(folder).not.toContain("working folder");
  const prompt = systemInstruction("short", { brainPath: brain });
  expect(prompt).toContain(`notes folder "${brain}" by default`);
  expect(prompt).toContain("relative folders start in the notes folder");
});
