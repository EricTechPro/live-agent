// Fast tests for helper jobs (ticket 06), through the agent core's event stream.
// Gemini CLI is never needed: each test points the adapter at a tiny fake CLI
// script (succeeds, fails, hangs, "not signed in", missing).
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/config/index.ts";
import { startSession, type SessionOptions } from "../src/core/agent.ts";
import type { AgentEvent, EventOf } from "../src/core/events.ts";
import type { ModelEvent, ModelInput } from "../src/core/model.ts";
import { loadTools } from "../src/core/registry.ts";
import { scriptedModel, type ScriptEntry } from "../src/models/scripted.ts";
import { geminiCliStatus, INSTALL_FIX, SIGN_IN_FIX } from "../src/helpers/gemini-cli.ts";

const dir = mkdtempSync(join(tmpdir(), "live-agent-jobs-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const tools = await loadTools();

/** Write a fake `gemini` script and return its path. */
function fakeCli(name: string, body: string) {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

const ok = fakeCli(
  "ok.sh",
  `echo "$PWD" > "${dir}/ok-cwd"
echo "$@" > "${dir}/ok-args"
echo "key=\${GEMINI_API_KEY:-none}" > "${dir}/ok-env"
echo 'not json, a warning'
echo '{"type":"init","session_id":"s1","model":"gemini"}'
echo '{"type":"message","role":"assistant","content":"Fixed the ","delta":true}'
echo '{"type":"message","role":"assistant","content":"bug.","delta":true}'
echo '{"type":"result","status":"success"}'`,
);
const fails = fakeCli("fails.sh", `echo "boom: tests are red" >&2\nexit 1`);
const notSignedIn = fakeCli("auth.sh", `echo "auth needed" >&2\nexit 41`);
// Hangs until killed. The background sleep ignores SIGINT (non-interactive sh),
// so only killing the whole process group stops it.
const hangs = fakeCli(
  "hangs.sh",
  `sleep 30 &\necho "$! $$" > "$PWD/hang.pid"\nwait`,
);
const slow = fakeCli("slow.sh", `sleep 0.3\necho '{"type":"message","role":"assistant","content":"slow done"}'`);

const startHelper = (id: string, task = "fix the bug", folder?: string): ModelEvent => ({
  type: "tool.call", id, name: "start_helper", args: folder ? { task, folder } : { task },
});
const say = (text: string): ModelEvent[] => [{ type: "text", text }];

/** A fake Gemini CLI home (what `~/.gemini` holds), signed in or not. */
function cliHome(name: string, files: Record<string, string>) {
  const home = join(dir, name);
  mkdirSync(join(home, ".gemini"), { recursive: true });
  for (const [file, text] of Object.entries(files)) writeFileSync(join(home, ".gemini", file), text);
  return home;
}
const signedInHome = cliHome("home-signed-in", {
  "settings.json": JSON.stringify({ security: { auth: { selectedType: "oauth-personal" } } }),
  "oauth_creds.json": "{}",
});
const signedOutHome = cliHome("home-signed-out", { "settings.json": "{}" });

function session(script: ScriptEntry[], bin: string, extra: Partial<SessionOptions> = {}) {
  return startSession({
    model: scriptedModel(script), tools, mode: "bypass", workDir: dir,
    helpers: { geminiCliBin: bin, geminiCliHome: signedInHome, cancelGraceMs: 200 }, ...extra,
  });
}

/** Collect every event, and wait for one that matches. */
function recorder(s: Awaited<ReturnType<typeof startSession>>) {
  const all: AgentEvent[] = [];
  const waiters: { match: (e: AgentEvent) => boolean; done: (e: AgentEvent) => void }[] = [];
  s.onEvent((e) => {
    all.push(e);
    for (const w of [...waiters]) if (w.match(e)) { waiters.splice(waiters.indexOf(w), 1); w.done(e); }
  });
  return {
    all,
    jobStates: (id?: string) =>
      all.filter((e): e is EventOf<"job.state"> => e.type === "job.state" && (!id || e.id === id)).map((e) => e.state),
    until(match: (e: AgentEvent) => boolean): Promise<AgentEvent> {
      const seen = all.find(match);
      if (seen) return Promise.resolve(seen);
      return new Promise((done) => waiters.push({ match, done }));
    },
  };
}
const jobEnded = (id: string) => (e: AgentEvent) =>
  e.type === "job.state" && e.id === id && ["done", "failed", "cancelled"].includes(e.state);

describe("starting a helper job", () => {
  test("a helper request starts a job and the reply does not wait for it", async () => {
    const s = await session([[startHelper("c1")], say("On it, I started a helper."), say("The helper finished.")], hangs);
    const rec = recorder(s);

    const events = await s.sendText("Fix the bug in this project.");

    expect(events).toContainEqual(expect.objectContaining({ type: "job.state", id: "job-1", kind: "gemini-cli", state: "running" }));
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool.result", id: "c1", name: "start_helper", status: "ok",
      output: expect.objectContaining({ jobId: "job-1" }),
    }));
    expect(events.at(-1)).toEqual({ type: "turn.done", reply: "On it, I started a helper." });
    // The job is still running after the turn ended.
    expect(rec.jobStates("job-1").at(-1)).toBe("running");
    await s.close();
  });

  test("starting a helper goes through the gate: helper risk asks in auto-edits", async () => {
    const s = await session([[startHelper("c1")], say("Shall I start a helper?")], ok, { mode: "auto-edits" });
    const events = await s.sendText("Fix the bug.");
    expect(events).toContainEqual(expect.objectContaining({ type: "safety.verdict", name: "start_helper", risk: "helper", verdict: "ask" }));
    expect(events.some((e) => e.type === "job.state")).toBe(false);
    await s.close();
  });

  test("the helper runs Gemini CLI headless in the folder, without our API key", async () => {
    const saved = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "secret-test-key";
    try {
      const s = await session([[startHelper("c1")], say("Started."), say("Done.")], ok);
      const rec = recorder(s);
      await s.sendText("Fix the bug.");
      await rec.until(jobEnded("job-1"));
      const args = readFileSync(join(dir, "ok-args"), "utf8");
      expect(args).toContain("-p fix the bug");
      expect(args).toContain("--output-format stream-json");
      expect(args).toContain("--approval-mode yolo");
      expect(args).toContain("--skip-trust");
      expect(readFileSync(join(dir, "ok-env"), "utf8").trim()).toBe("key=none");
      await s.close();
    } finally {
      if (saved === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = saved;
    }
  });
});

describe("job states", () => {
  test("state changes appear on the stream in order, ending with the CLI's answer", async () => {
    const s = await session([[startHelper("c1")], say("Started."), say("Done.")], ok);
    const rec = recorder(s);
    await s.sendText("Fix the bug.");
    const end = (await rec.until(jobEnded("job-1"))) as EventOf<"job.state">;

    expect(rec.jobStates("job-1")).toEqual(["queued", "running", "done"]);
    expect(end).toMatchObject({ kind: "gemini-cli", title: "fix the bug", message: "Fixed the bug." });
    await s.close();
  });

  test("a failing CLI moves the job to failed with its error output", async () => {
    const s = await session([[startHelper("c1")], say("Started."), say("It failed.")], fails);
    const rec = recorder(s);
    await s.sendText("Fix the bug.");
    const end = (await rec.until(jobEnded("job-1"))) as EventOf<"job.state">;
    expect(rec.jobStates("job-1")).toEqual(["queued", "running", "failed"]);
    expect(end.message).toContain("boom: tests are red");
    await s.close();
  });

  test("with max-at-once 1, a second job waits in queued until the first ends", async () => {
    const config = defaultConfig();
    config.helpers.maxAtOnce = 1;
    const s = await session(
      [[startHelper("c1", "first"), startHelper("c2", "second")], say("Started two."), say("one"), say("two")],
      slow, { config },
    );
    const rec = recorder(s);
    await s.sendText("Do two things.");
    expect(rec.jobStates("job-1")).toEqual(["queued", "running"]);
    expect(rec.jobStates("job-2")).toEqual(["queued"]);

    await rec.until(jobEnded("job-2"));
    const order = rec.all
      .filter((e): e is EventOf<"job.state"> => e.type === "job.state")
      .map((e) => `${e.id}:${e.state}`);
    expect(order).toEqual(["job-1:queued", "job-1:running", "job-2:queued", "job-1:done", "job-2:running", "job-2:done"]);
    await s.close();
  });

  test("with max-at-once 2, two jobs run side by side", async () => {
    const config = defaultConfig();
    config.helpers.maxAtOnce = 2;
    const s = await session(
      [[startHelper("c1", "first"), startHelper("c2", "second")], say("Started two."), say("one"), say("two")],
      slow, { config },
    );
    const rec = recorder(s);
    await s.sendText("Do two things.");
    expect(rec.jobStates("job-2")).toEqual(["queued", "running"]);
    await s.close();
  });
});

describe("cancelling", () => {
  test("cancelling a running job moves it to cancelled and stops the whole process", async () => {
    mkdirSync(join(dir, "cancel-run"));
    const pidFile = join(dir, "cancel-run", "hang.pid");
    const s = await session([[startHelper("c1", "fix the bug", "cancel-run")], say("Started."), say("Cancelled it.")], hangs);
    const rec = recorder(s);
    await s.sendText("Fix the bug.");

    // Wait until the fake CLI wrote its pids (the background sleep and the shell).
    while (!existsSync(pidFile) || readFileSync(pidFile, "utf8").trim().split(" ").length < 2) await Bun.sleep(10);
    const pids = readFileSync(pidFile, "utf8").trim().split(" ").map(Number);
    expect(pids.every(alive)).toBe(true);

    expect(s.jobs.cancel("job-1")).toBe(true);
    await rec.until(jobEnded("job-1"));

    expect(rec.jobStates("job-1")).toEqual(["queued", "running", "cancelled"]);
    for (const pid of pids) expect(alive(pid)).toBe(false);
    await s.close();
  });

  test("cancelling a queued job removes it before it runs", async () => {
    const config = defaultConfig();
    config.helpers.maxAtOnce = 1;
    const s = await session(
      [[startHelper("c1", "first"), startHelper("c2", "second")], say("Started."), say("x"), say("y"), say("z")],
      hangs, { config },
    );
    const rec = recorder(s);
    await s.sendText("Two things.");
    expect(s.jobs.cancel("job-2")).toBe(true);
    expect(rec.jobStates("job-2")).toEqual(["queued", "cancelled"]);
    expect(s.jobs.cancel("job-404")).toBe(false);
    await s.close();
  });

  test("the voice can cancel a job with cancel_job", async () => {
    const s = await session(
      [[startHelper("c1")], say("Started."), [{ type: "tool.call", id: "c2", name: "cancel_job", args: { jobId: "job-1" } }], say("Stopping it."), say("It is cancelled.")],
      hangs,
    );
    const rec = recorder(s);
    await s.sendText("Fix the bug.");
    await s.sendText("Actually, stop that job.");
    await rec.until(jobEnded("job-1"));
    expect(rec.jobStates("job-1").at(-1)).toBe("cancelled");
    await s.close();
  });

  test("closing the session stops running jobs", async () => {
    const s = await session([[startHelper("c1")], say("Started.")], hangs);
    const rec = recorder(s);
    await s.sendText("Fix the bug.");
    await s.close();
    expect(rec.jobStates("job-1").at(-1)).toBe("cancelled");
  });
});

describe("Gemini CLI missing or not signed in", () => {
  test("a missing binary fails the job with how to install it", async () => {
    const s = await session([[startHelper("c1")], say("Started."), say("It failed.")], join(dir, "no-such-gemini"));
    const rec = recorder(s);
    await s.sendText("Fix the bug.");
    const end = (await rec.until(jobEnded("job-1"))) as EventOf<"job.state">;
    expect(end.state).toBe("failed");
    expect(end.message).toContain("npm install -g @google/gemini-cli");
    await s.close();
  });

  test("installed but not signed in fails the job with how to sign in, without running the CLI", async () => {
    const s = await session([[startHelper("c1")], say("Started."), say("It failed.")], ok, {
      helpers: { geminiCliBin: ok, geminiCliHome: signedOutHome },
    });
    rmSync(join(dir, "ok-args"), { force: true });
    const rec = recorder(s);
    await s.sendText("Fix the bug.");
    const end = (await rec.until(jobEnded("job-1"))) as EventOf<"job.state">;
    expect(end.state).toBe("failed");
    expect(end.message).toContain("isn't signed in");
    expect(existsSync(join(dir, "ok-args"))).toBe(false);
    await s.close();
  });

  test("the status check tells missing, signed out and ready apart", () => {
    expect(geminiCliStatus({ bin: join(dir, "nope"), home: signedInHome })).toEqual({ ok: false, installed: false, fix: INSTALL_FIX });
    expect(geminiCliStatus({ bin: ok, home: signedOutHome })).toEqual({ ok: false, installed: true, bin: ok, fix: SIGN_IN_FIX });
    expect(geminiCliStatus({ bin: ok, home: signedInHome })).toEqual({ ok: true, installed: true, bin: ok });
    const apiKeyHome = cliHome("home-api-key", {
      "settings.json": JSON.stringify({ security: { auth: { selectedType: "gemini-api-key" } } }),
    });
    expect(geminiCliStatus({ bin: ok, home: apiKeyHome }).ok).toBe(true);
  });

  test("exit code 41 fails the job with how to sign in", async () => {
    const s = await session([[startHelper("c1")], say("Started."), say("It failed.")], notSignedIn);
    const rec = recorder(s);
    await s.sendText("Fix the bug.");
    const end = (await rec.until(jobEnded("job-1"))) as EventOf<"job.state">;
    expect(end.state).toBe("failed");
    expect(end.message).toContain("isn't signed in");
    expect(end.message).toContain("gemini");
    await s.close();
  });

  test("with Gemini CLI turned off in the config, no job starts and the model is told why", async () => {
    const config = defaultConfig();
    config.helpers.geminiCli = false;
    const s = await session([[startHelper("c1")], say("Helpers are off.")], ok, { config });
    const events = await s.sendText("Fix the bug.");
    expect(events.some((e) => e.type === "job.state")).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({
      type: "tool.result", id: "c1", status: "error", error: expect.stringContaining("helpers.geminiCli"),
    }));
    await s.close();
  });
});

describe("announcing finished jobs", () => {
  // The fake model's answer is built from what the core sent, so the test
  // proves the job's result really reached the model.
  const announce = (input: ModelInput): ModelEvent[] => {
    if (input.type !== "tool.response") return say("no job news");
    const out = input.response.output as { state?: string; message?: string };
    return say(`Your helper is ${out.state}: ${out.message}`);
  };

  test("when a job finishes, the agent says so in the conversation", async () => {
    const s = await session([[startHelper("c1")], say("On it."), announce], ok);
    const rec = recorder(s);
    await s.sendText("Fix the bug.");
    await rec.until((e) => e.type === "transcript" && e.role === "model" && e.text.startsWith("Your helper"));

    const lastSaid = rec.all.filter((e) => e.type === "transcript" && e.role === "model").at(-1);
    expect(lastSaid).toEqual({ type: "transcript", role: "model", text: "Your helper is done: Fixed the bug." });
    // The first answer told the model more is coming; the last one closes the call.
    expect(rec.all.filter((e) => e.type === "tool.result" && e.id === "c1").map((e) => (e as EventOf<"tool.result">).output))
      .toEqual([expect.objectContaining({ jobId: "job-1", state: "running" }), expect.objectContaining({ jobId: "job-1", state: "done" })]);
    await s.close();
  });

  test("a failed job is announced with its fix", async () => {
    const s = await session([[startHelper("c1")], say("On it."), announce], notSignedIn);
    const rec = recorder(s);
    await s.sendText("Fix the bug.");
    const said = await rec.until((e) => e.type === "transcript" && e.role === "model" && e.text.startsWith("Your helper"));
    expect((said as EventOf<"transcript">).text).toContain("failed: Gemini CLI isn't signed in");
    await s.close();
  });
});

describe("other job kinds", () => {
  test("any job runner can be submitted and shows the same states", async () => {
    const s = await session([], ok);
    const rec = recorder(s);
    const id = s.jobs.submit({ kind: "tidy", title: "tidy raw notes", run: async () => "2 wiki pages updated" });
    await rec.until(jobEnded(id));
    expect(rec.jobStates(id)).toEqual(["queued", "running", "done"]);
    expect(s.jobs.list()).toContainEqual(expect.objectContaining({ id, kind: "tidy", state: "done", message: "2 wiki pages updated" }));
    await s.close();
  });
});

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
