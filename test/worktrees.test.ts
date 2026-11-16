// Fast tests for worktrees per helper job (ticket 17), through the agent core's
// event stream. Real temp git repos, a fake helper CLI script.
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/config/index.ts";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent, EventOf } from "../src/core/events.ts";
import type { ModelEvent, ModelInput } from "../src/core/model.ts";
import { loadTools } from "../src/core/registry.ts";
import { scriptedModel, type ScriptEntry } from "../src/models/scripted.ts";

const dir = realpathSync(mkdtempSync(join(tmpdir(), "live-agent-worktrees-")));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const tools = await loadTools();
const worktreesRoot = join(dir, "worktrees-root");

function git(cwd: string, ...args: string[]) {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

/** A fresh git repo with one commit, on branch main. */
let repos = 0;
function repo(): string {
  const path = join(dir, `repo-${++repos}`);
  mkdirSync(path);
  git(path, "init", "-q", "-b", "main");
  git(path, "config", "user.name", "Test");
  git(path, "config", "user.email", "test@example.com");
  writeFileSync(join(path, "add.js"), "export const add = (a, b) => a - b;\n");
  git(path, "add", "-A");
  git(path, "commit", "-q", "-m", "first");
  return path;
}

// The fake helper: notes where it ran, then "fixes" add.js in its folder.
const fixer = join(dir, "fixer.sh");
writeFileSync(
  fixer,
  `#!/bin/sh
echo "$PWD" > "${dir}/fixer-cwd"
echo "export const add = (a, b) => a + b;" > add.js
echo '{"type":"message","role":"assistant","content":"Fixed add."}'
echo '{"type":"result","status":"success"}'
`,
);
chmodSync(fixer, 0o755);

const startHelper = (id: string, folder: string, task = "fix the add bug"): ModelEvent => ({
  type: "tool.call", id, name: "start_helper", args: { task, folder },
});
const say = (text: string): ModelEvent[] => [{ type: "text", text }];

function session(script: ScriptEntry[], worktrees: boolean, geminiCliBin = fixer) {
  const config = defaultConfig();
  config.worktrees = worktrees;
  return startSession({
    model: scriptedModel(script), tools, mode: "bypass", workDir: dir, config,
    helpers: { geminiCliBin, geminiCliHome: join(dir, "helper-home"), geminiApiKey: "k", worktreesRoot },
  });
}

function recorder(s: Awaited<ReturnType<typeof startSession>>) {
  const all: AgentEvent[] = [];
  const waiters: { match: (e: AgentEvent) => boolean; done: (e: AgentEvent) => void }[] = [];
  s.onEvent((e) => {
    all.push(e);
    for (const w of [...waiters]) if (w.match(e)) { waiters.splice(waiters.indexOf(w), 1); w.done(e); }
  });
  return {
    all,
    until(match: (e: AgentEvent) => boolean): Promise<AgentEvent> {
      const seen = all.find(match);
      if (seen) return Promise.resolve(seen);
      return new Promise((done) => waiters.push({ match, done }));
    },
  };
}
const jobEnded = (e: AgentEvent): e is EventOf<"job.state"> =>
  e.type === "job.state" && ["done", "failed", "cancelled"].includes(e.state);

describe("worktrees on", () => {
  test("a helper job runs in a new worktree on a new branch, and the user's branch is untouched", async () => {
    const project = repo();
    const s = await session([[startHelper("c1", project)], say("Started."), say("Done.")], true);
    const rec = recorder(s);
    await s.sendText("Fix the add bug.");
    const end = (await rec.until(jobEnded)) as EventOf<"job.state">;

    expect(end.state).toBe("done");
    const { path, branch } = end.worktree!;
    expect(branch).toStartWith("live-agent/");
    expect(path.startsWith(worktreesRoot)).toBe(true);
    // The helper ran in the worktree, not in the project.
    expect(readFileSync(join(dir, "fixer-cwd"), "utf8").trim()).toBe(path);
    // The user's checkout: same branch, same file, nothing changed.
    expect(git(project, "branch", "--show-current")).toBe("main");
    expect(git(project, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(project, "add.js"), "utf8")).toContain("a - b");
    // The fix is committed on the worktree's branch, ready to review.
    expect(git(project, "show", `${branch}:add.js`)).toContain("a + b");
    await s.close();
  });

  test("the agent is told where the work is, when starting and when announcing", async () => {
    const project = repo();
    // The fake model's last line is built from what the core sent at the job's end.
    const announce = (input: ModelInput): ModelEvent[] => {
      if (input.type !== "tool.response") return say("no job news");
      const out = input.response.output as { state?: string; worktree?: { branch: string } };
      return say(`Your helper is ${out.state} on branch ${out.worktree?.branch}`);
    };
    const s = await session([[startHelper("c1", project)], say("Started."), announce], true);
    const rec = recorder(s);
    const events = await s.sendText("Fix the add bug.");
    const started = events.find((e): e is EventOf<"tool.result"> => e.type === "tool.result" && e.id === "c1")!;
    const { worktree } = started.output as { worktree: { path: string; branch: string } };
    expect(worktree.branch).toStartWith("live-agent/fix-the-add-bug-");

    const said = await rec.until((e) => e.type === "transcript" && e.role === "model" && e.text.startsWith("Your helper"));
    expect((said as EventOf<"transcript">).text).toBe(`Your helper is done on branch ${worktree.branch}`);
    await s.close();
  });

  test("a folder that is not a git project gives a clear message, and no job starts", async () => {
    const plain = join(dir, "not-git");
    mkdirSync(plain);
    const s = await session([[startHelper("c1", plain)], say("That folder is not a git project.")], true);
    const events = await s.sendText("Fix the add bug.");
    expect(events.some((e) => e.type === "job.state")).toBe(false);
    const result = events.find((e): e is EventOf<"tool.result"> => e.type === "tool.result" && e.id === "c1")!;
    expect(result.status).toBe("error");
    expect(result.error).toContain("is not a git project");
    expect(result.error).toContain("git init");
    expect(result.error).toContain('"worktrees": false');
    await s.close();
  });

  test("a helper that is not installed gives the fix right away: no job, no worktree, no branch", async () => {
    const project = repo();
    const s = await session([[startHelper("c1", project)], say("Install Gemini CLI first.")], true, join(dir, "no-such-gemini"));
    const events = await s.sendText("Fix the add bug.");
    expect(events.some((e) => e.type === "job.state")).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool.result", id: "c1", status: "error", error: expect.stringContaining("npm install -g @google/gemini-cli"),
    }));
    expect(git(project, "branch", "--list")).toBe("* main");
    expect(git(project, "worktree", "list").split("\n")).toHaveLength(1);
    await s.close();
  });

  test("a git project with no commits yet says to make a first commit", async () => {
    const empty = join(dir, "empty-repo");
    mkdirSync(empty);
    git(empty, "init", "-q");
    const s = await session([[startHelper("c1", empty)], say("Make a first commit.")], true);
    const events = await s.sendText("Fix the add bug.");
    expect(events.some((e) => e.type === "job.state")).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool.result", id: "c1", status: "error", error: expect.stringContaining("no commits yet"),
    }));
    await s.close();
  });
});

describe("worktrees off", () => {
  test("the helper works in the folder itself, with no worktree and no new branch", async () => {
    const project = repo();
    const s = await session([[startHelper("c1", project)], say("Started."), say("Done.")], false);
    const rec = recorder(s);
    await s.sendText("Fix the add bug.");
    const end = (await rec.until(jobEnded)) as EventOf<"job.state">;
    expect(end.state).toBe("done");
    expect(end.worktree).toBeUndefined();
    expect(readFileSync(join(dir, "fixer-cwd"), "utf8").trim()).toBe(project);
    expect(readFileSync(join(project, "add.js"), "utf8")).toContain("a + b");
    expect(git(project, "branch", "--list")).toBe("* main");
    expect(git(project, "worktree", "list").split("\n")).toHaveLength(1);
    await s.close();
  });
});
