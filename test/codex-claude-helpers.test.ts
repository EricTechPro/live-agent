// Fast tests for the Codex and Claude Code helpers (ticket 18), through the
// agent core's event stream. Real CLIs are never needed: each test points the
// adapter at a tiny fake CLI script that answers its sign-in check and prints
// scripted output.
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, type Config } from "../src/config/index.ts";
import { startSession, type SessionOptions } from "../src/core/agent.ts";
import type { AgentEvent, EventOf } from "../src/core/events.ts";
import type { ModelEvent } from "../src/core/model.ts";
import { loadTools } from "../src/core/registry.ts";
import { scriptedModel, type ScriptEntry } from "../src/models/scripted.ts";

const dir = mkdtempSync(join(tmpdir(), "live-agent-helpers18-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const tools = await loadTools();

function fakeCli(name: string, body: string) {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

// Records how it was run, answers the sign-in check, then prints Codex's --json events.
const codexOk = fakeCli(
  "codex-ok.sh",
  `if [ "$1" = login ]; then echo "Logged in using ChatGPT"; exit 0; fi
echo "$PWD" > "${dir}/codex-cwd"
echo "$@" > "${dir}/codex-args"
echo "gemini=\${GEMINI_API_KEY:-none} google=\${GOOGLE_API_KEY:-none}" > "${dir}/codex-env"
echo '{"type":"thread.started","thread_id":"t1"}'
echo '{"type":"item.completed","item":{"id":"i0","type":"reasoning","text":"thinking"}}'
echo '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"Fixed the off-by-one."}}'
echo '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}'`,
);
const codexSignedOut = fakeCli(
  "codex-out.sh",
  `if [ "$1" = login ]; then echo "Not logged in" >&2; exit 1; fi
echo ran > "${dir}/codex-out-ran"`,
);
const codexFails = fakeCli(
  "codex-fails.sh",
  `if [ "$1" = login ]; then exit 0; fi
echo '{"type":"turn.failed","error":{"message":"model overloaded"}}'
exit 1`,
);

const claudeOk = fakeCli(
  "claude-ok.sh",
  `if [ "$1" = auth ]; then echo '{"loggedIn": true}'; exit 0; fi
echo "$PWD" > "${dir}/claude-cwd"
echo "$@" > "${dir}/claude-args"
echo "gemini=\${GEMINI_API_KEY:-none} google=\${GOOGLE_API_KEY:-none}" > "${dir}/claude-env"
echo '{"type":"result","subtype":"success","is_error":false,"result":"Fixed it in add.js."}'`,
);
const claudeSignedOut = fakeCli(
  "claude-out.sh",
  `if [ "$1" = auth ]; then echo '{"loggedIn": false}'; exit 1; fi
echo ran > "${dir}/claude-out-ran"`,
);
const claudeFails = fakeCli(
  "claude-fails.sh",
  `if [ "$1" = auth ]; then exit 0; fi
echo '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Could not edit add.js"}'
exit 1`,
);
// Hangs until killed; the background sleep ignores SIGINT, so only a group kill stops it.
const claudeHangs = fakeCli(
  "claude-hangs.sh",
  `if [ "$1" = auth ]; then exit 0; fi
sleep 30 &
echo "$! $$" > "$PWD/claude-hang.pid"
wait`,
);

const startHelper = (id: string, args: Record<string, unknown>): ModelEvent => ({
  type: "tool.call", id, name: "start_helper", args: { task: "fix the bug", ...args },
});
const say = (text: string): ModelEvent[] => [{ type: "text", text }];

function configWith(on: Partial<Config["helpers"]>): Config {
  const config = defaultConfig();
  config.helpers = { ...config.helpers, geminiCli: false, ...on };
  // Helper jobs with no folder start in the brain folder (ticket 21): here, the temp dir.
  config.brainPath = dir;
  return config;
}

function session(script: ScriptEntry[], config: Config, helpers: SessionOptions["helpers"] = {}) {
  return startSession({
    model: scriptedModel(script), tools, mode: "bypass", workDir: dir, config,
    helpers: { geminiCliBin: join(dir, "no-gemini"), geminiApiKey: "secret-test-key", cancelGraceMs: 200, ...helpers },
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
    until(match: (e: AgentEvent) => boolean): Promise<AgentEvent> {
      const seen = all.find(match);
      if (seen) return Promise.resolve(seen);
      return new Promise((done) => waiters.push({ match, done }));
    },
  };
}
const jobEnded = (id: string) => (e: AgentEvent) =>
  e.type === "job.state" && e.id === id && ["done", "failed", "cancelled"].includes(e.state);

/** Run one start_helper call and return the job's last state event. */
async function runJob(args: Record<string, unknown>, config: Config, helpers: SessionOptions["helpers"] = {}) {
  const s = await session([[startHelper("c1", args)], say("Started."), say("Finished.")], config, helpers);
  const rec = recorder(s);
  const events = await s.sendText("Fix the bug.");
  const end = (await rec.until(jobEnded("job-1"))) as EventOf<"job.state">;
  await s.close();
  return { events, end };
}

/** Run one start_helper call that should be refused before any job starts; return its error. */
async function refusedStart(args: Record<string, unknown>, config: Config, helpers: SessionOptions["helpers"] = {}) {
  const s = await session([[startHelper("c1", args)], say("Not ready.")], config, helpers);
  const events = await s.sendText("Fix the bug.");
  await s.close();
  expect(events.some((e) => e.type === "job.state")).toBe(false);
  const result = events.find((e): e is EventOf<"tool.result"> => e.type === "tool.result" && e.id === "c1")!;
  expect(result.status).toBe("error");
  return result.error ?? "";
}

describe("Codex helper", () => {
  test("turning Codex on lets the agent start a Codex job that edits unattended in the folder", async () => {
    const saved = process.env.GOOGLE_API_KEY;
    process.env.GOOGLE_API_KEY = "voice-key-in-env";
    try {
      const { end } = await runJob({ helper: "codex" }, configWith({ codex: true }), { codexBin: codexOk });
      expect(end).toMatchObject({ kind: "codex", state: "done", message: "Fixed the off-by-one." });
      const args = readFileSync(join(dir, "codex-args"), "utf8");
      expect(args).toContain("exec --json");
      expect(args).toContain("--sandbox workspace-write");
      expect(args.trim().endsWith("fix the bug")).toBe(true);
      expect(readFileSync(join(dir, "codex-cwd"), "utf8").trim()).toBe(await realpath(dir));
      // The user's Gemini key never reaches another vendor's CLI.
      expect(readFileSync(join(dir, "codex-env"), "utf8").trim()).toBe("gemini=none google=none");
    } finally {
      if (saved === undefined) delete process.env.GOOGLE_API_KEY;
      else process.env.GOOGLE_API_KEY = saved;
    }
  });

  test("a signed-out Codex starts no job and says how to sign in, without running a task", async () => {
    const error = await refusedStart({ helper: "codex" }, configWith({ codex: true }), { codexBin: codexSignedOut });
    expect(error).toContain("codex login");
    expect(existsSync(join(dir, "codex-out-ran"))).toBe(false);
  });

  test("a missing Codex starts no job and says how to install it", async () => {
    const error = await refusedStart({ helper: "codex" }, configWith({ codex: true }), { codexBin: join(dir, "no-codex") });
    expect(error).toContain("npm install -g @openai/codex");
  });

  test("a Codex error ends the job failed with the error", async () => {
    const { end } = await runJob({ helper: "codex" }, configWith({ codex: true }), { codexBin: codexFails });
    expect(end).toMatchObject({ state: "failed", message: expect.stringContaining("model overloaded") });
  });

  test("a task failure that only mentions a login form is not reported as signed out", async () => {
    const loginForm = fakeCli(
      "codex-login-form.sh",
      `if [ "$1" = login ]; then exit 0; fi
echo '{"type":"turn.failed","error":{"message":"could not fix the login form: tests still fail"}}'
exit 1`,
    );
    const { end } = await runJob({ helper: "codex" }, configWith({ codex: true }), { codexBin: loginForm });
    expect(end.state).toBe("failed");
    expect(end.message).toContain("could not fix the login form");
    expect(end.message).not.toContain("not signed in");
  });

  test("a model Codex's own config picks but the account cannot use fails with where to change it", async () => {
    const badModel = fakeCli(
      "codex-model.sh",
      `if [ "$1" = login ]; then exit 0; fi
echo '{"type":"error","message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The x-9 model is not supported when using Codex with a ChatGPT account.\\",\\"code\\":\\"model_not_found\\"}}"}'
exit 1`,
    );
    const { end } = await runJob({ helper: "codex" }, configWith({ codex: true }), { codexBin: badModel });
    expect(end.state).toBe("failed");
    expect(end.message).toContain("The x-9 model is not supported");
    expect(end.message).toContain("~/.codex/config.toml");
    expect(end.message).not.toContain("{");
  });
});

describe("Claude Code helper", () => {
  test("turning Claude Code on lets the agent start a Claude Code job that edits unattended", async () => {
    const { end } = await runJob({ helper: "claude-code" }, configWith({ claudeCode: true }), { claudeCodeBin: claudeOk });
    expect(end).toMatchObject({ kind: "claude-code", state: "done", message: "Fixed it in add.js." });
    const args = readFileSync(join(dir, "claude-args"), "utf8");
    expect(args).toContain("-p fix the bug");
    expect(args).toContain("--output-format json");
    expect(args).toContain("--permission-mode bypassPermissions");
    expect(readFileSync(join(dir, "claude-cwd"), "utf8").trim()).toBe(await realpath(dir));
    expect(readFileSync(join(dir, "claude-env"), "utf8").trim()).toBe("gemini=none google=none");
  });

  test("a signed-out Claude Code starts no job and says how to sign in", async () => {
    const error = await refusedStart({ helper: "claude-code" }, configWith({ claudeCode: true }), { claudeCodeBin: claudeSignedOut });
    expect(error).toContain("claude auth login");
    expect(existsSync(join(dir, "claude-out-ran"))).toBe(false);
  });

  test("a Claude Code error ends the job failed with its message", async () => {
    const { end } = await runJob({ helper: "claude-code" }, configWith({ claudeCode: true }), { claudeCodeBin: claudeFails });
    expect(end).toMatchObject({ state: "failed", message: expect.stringContaining("Could not edit add.js") });
  });

  test("cancelling a Claude Code job stops its whole process group", async () => {
    const s = await session([[startHelper("c1", { helper: "claude-code" })], say("Started.")], configWith({ claudeCode: true }), {
      claudeCodeBin: claudeHangs,
    });
    const rec = recorder(s);
    await s.sendText("Fix the bug.");
    const pidFile = join(dir, "claude-hang.pid");
    for (let i = 0; i < 100 && !(await Bun.file(pidFile).exists()); i++) await Bun.sleep(20);
    const [sleepPid] = readFileSync(pidFile, "utf8").trim().split(" ").map(Number);
    s.jobs.cancel("job-1");
    const end = (await rec.until(jobEnded("job-1"))) as EventOf<"job.state">;
    expect(end.state).toBe("cancelled");
    await Bun.sleep(100);
    expect(() => process.kill(sleepPid!, 0)).toThrow();
    await s.close();
  });
});

describe("choosing a helper", () => {
  test("with no helper named, the first one turned on is used (Gemini CLI, Codex, Claude Code)", async () => {
    const { end } = await runJob({}, configWith({ codex: true, claudeCode: true }), { codexBin: codexOk, claudeCodeBin: claudeOk });
    expect(end.kind).toBe("codex");
    const both = await runJob({}, configWith({ claudeCode: true }), { claudeCodeBin: claudeOk });
    expect(both.end.kind).toBe("claude-code");
  });

  test("the user can name a helper that is not the default", async () => {
    const { end } = await runJob({ helper: "claude-code" }, configWith({ codex: true, claudeCode: true }), {
      codexBin: codexOk, claudeCodeBin: claudeOk,
    });
    expect(end.kind).toBe("claude-code");
  });

  test("naming a helper that is turned off starts no job and says how to turn it on", async () => {
    const s = await session([[startHelper("c1", { helper: "codex" })], say("Codex is off.")], configWith({ claudeCode: true }), {
      codexBin: codexOk,
    });
    const events = await s.sendText("Use Codex to fix the bug.");
    expect(events.some((e) => e.type === "job.state")).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool.result", id: "c1", status: "error", error: expect.stringContaining("helpers.codex"),
    }));
    await s.close();
  });

  test("with every helper turned off, no job starts and the model is told why", async () => {
    const s = await session([[startHelper("c1", {})], say("Helpers are off.")], configWith({}));
    const events = await s.sendText("Fix the bug.");
    expect(events.some((e) => e.type === "job.state")).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool.result", id: "c1", status: "error", error: expect.stringContaining("turned off"),
    }));
    await s.close();
  });
});

async function realpath(p: string) {
  return (await import("node:fs")).realpathSync(p);
}
