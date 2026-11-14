// Live smoke test: one real text turn through the agent core and real Gemini Live.
// No microphone needed; text stands in for voice (same idea as live-dj's smoke_live).
//
//   bun run smoke
//
// Needs GEMINI_API_KEY (or GOOGLE_API_KEY, the name AI Studio suggests) in your environment or .env.
// With no key it skips cleanly, so it is safe to run anywhere.
import { expect, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/config/index.ts";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent } from "../src/core/events.ts";
import { geminiLiveModel } from "../src/models/gemini-live.ts";
import { geminiTidyModel } from "../src/models/gemini-tidy.ts";
import { scriptedModel } from "../src/models/scripted.ts";

const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
if (!apiKey) console.log("live smoke: skipped (no GEMINI_API_KEY; copy .env.example to .env)");

test.skipIf(!apiKey)(
  "a real text turn comes back as transcript events",
  async () => {
    const session = await startSession({ model: geminiLiveModel({ apiKey: apiKey! }) });
    try {
      const events = await session.sendText("Say hello in five words or fewer.");
      const done = events.find((e) => e.type === "turn.done");

      console.log("  you said:  ", "Say hello in five words or fewer.");
      console.log("  model said:", done?.reply || "(no transcript)");
      const errors = events.filter((e) => e.type === "error");
      if (errors.length) console.log("  errors:    ", errors);

      expect(events.some((e) => e.type === "transcript" && e.role === "model")).toBe(true);
      expect(done?.reply.trim()).not.toBe("");
    } finally {
      await session.close();
    }
  },
  30_000,
);

test.skipIf(!apiKey)(
  "a real model reads a named file through read_file",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "live-agent-smoke-"));
    writeFileSync(join(dir, "shopping.md"), "The secret word is pineapple.");
    const session = await startSession({ model: geminiLiveModel({ apiKey: apiKey! }), workDir: dir });
    try {
      const events = await session.sendText("Read the file shopping.md and tell me the secret word.");
      const done = events.find((e) => e.type === "turn.done");
      console.log("  tool calls:", events.filter((e) => e.type === "tool.call"));
      console.log("  model said:", done?.reply || "(no transcript)");

      expect(events).toContainEqual(expect.objectContaining({ type: "tool.call", name: "read_file" }));
      expect(events).toContainEqual(expect.objectContaining({ type: "tool.result", status: "ok" }));
      expect(done?.reply.toLowerCase()).toContain("pineapple");
    } finally {
      await session.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
  45_000,
);

test.skipIf(!apiKey)(
  "a real model starts a helper job and announces when it is done",
  async () => {
    // Gemini CLI stands in as a tiny fake script, so the job reaches done
    // without a real CLI or a Google sign-in.
    const dir = mkdtempSync(join(tmpdir(), "live-agent-smoke-"));
    const bin = join(dir, "fake-gemini.sh");
    writeFileSync(
      bin,
      `#!/bin/sh\nsleep 8\necho '{"type":"message","role":"assistant","content":"Fixed the off-by-one bug in counter.ts."}'\necho '{"type":"result","status":"success"}'\n`,
    );
    chmodSync(bin, 0o755);
    // A fake signed-in Gemini CLI home, so the sign-in check passes on any machine.
    mkdirSync(join(dir, "home", ".gemini"), { recursive: true });
    writeFileSync(join(dir, "home", ".gemini", "oauth_creds.json"), "{}");
    // Bypass: helper risk asks in auto-edits; this smoke is about the job, not the gate.
    const session = await startSession({
      model: geminiLiveModel({ apiKey: apiKey! }), workDir: dir, mode: "bypass",
      helpers: { geminiCliBin: bin, geminiCliHome: join(dir, "home") },
    });
    const all: AgentEvent[] = [];
    session.onEvent((e) => all.push(e));
    try {
      const events = await session.sendText(
        "Start a helper to fix the off-by-one bug in counter.ts in this project. Tell me when it is done.",
      );
      console.log("  first reply:", events.find((e) => e.type === "turn.done"));
      expect(events).toContainEqual(expect.objectContaining({ type: "tool.call", name: "start_helper" }));

      // Wait for the job to end, then for the model to speak about it.
      const deadline = Date.now() + 40_000;
      const doneAt = () => all.findIndex((e) => e.type === "job.state" && e.state === "done");
      const announced = () => {
        const i = doneAt();
        return i >= 0 && all.slice(i).some((e) => e.type === "transcript" && e.role === "model");
      };
      while (!announced() && Date.now() < deadline) await Bun.sleep(200);
      await Bun.sleep(3000); // let the spoken announcement finish
      const said = all
        .slice(Math.max(doneAt(), 0))
        .filter((e) => e.type === "transcript" && e.role === "model")
        .map((e) => (e as { text: string }).text)
        .join("");
      console.log("  job states:", all.filter((e) => e.type === "job.state").map((e) => (e as { state: string }).state));
      console.log("  announced: ", said || "(nothing)");
      const errors = all.filter((e) => e.type === "error");
      if (errors.length) console.log("  errors:    ", errors);

      expect(doneAt()).toBeGreaterThanOrEqual(0);
      expect(said.trim()).not.toBe("");
    } finally {
      await session.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
  90_000,
);

test.skipIf(!apiKey)(
  "brain answer reports notes used",
  async () => {
    // Default config: the repo's sample brain. Gus is the sample starter's name.
    const session = await startSession({ model: geminiLiveModel({ apiKey: apiKey! }) });
    try {
      const events = await session.sendText(
        "Check my notes: what is my sourdough starter called, and how often do I feed it on the counter?",
      );
      const done = events.find((e) => e.type === "turn.done");
      const used = events.find((e) => e.type === "notes.used");
      console.log("  tool calls:", events.filter((e) => e.type === "tool.call"));
      console.log("  notes used:", used);
      console.log("  model said:", done?.reply || "(no transcript)");

      expect(events).toContainEqual(expect.objectContaining({ type: "tool.call", name: "search_brain" }));
      expect(used).toEqual({ type: "notes.used", notes: expect.arrayContaining(["wiki/sourdough-starter.md"]) });
      expect(done?.reply.toLowerCase()).toContain("gus");
    } finally {
      await session.close();
    }
  },
  45_000,
);

test.skipIf(!apiKey)(
  "remember this writes a raw note, and close writes the chat-end note",
  async () => {
    const brain = mkdtempSync(join(tmpdir(), "live-agent-smoke-brain-"));
    const config = { ...defaultConfig(), brainPath: brain };
    const session = await startSession({ model: geminiLiveModel({ apiKey: apiKey! }), config });
    const seen: AgentEvent[] = [];
    session.onEvent((e) => seen.push(e));
    try {
      const events = await session.sendText("Remember this: the garden gate code is 4512.");
      const done = events.find((e) => e.type === "turn.done");
      console.log("  tool calls:", events.filter((e) => e.type === "tool.call"));
      console.log("  model said:", done?.reply || "(no transcript)");

      const remembered = events.find((e) => e.type === "brain.write");
      expect(remembered).toEqual(expect.objectContaining({ type: "brain.write", cause: "tool", tool: "remember" }));
      const path = (remembered as { path: string }).path;
      expect(readFileSync(join(brain, path), "utf8")).toContain("4512");
    } finally {
      await session.close();
      const chatEnd = seen.filter((e) => e.type === "brain.write" && e.cause === "chat-end");
      const notePath = (chatEnd[0] as { path: string } | undefined)?.path;
      console.log("  raw files: ", readdirSync(join(brain, "raw")));
      if (notePath) console.log("  chat note:\n" + readFileSync(join(brain, notePath), "utf8"));
      rmSync(brain, { recursive: true, force: true });
      expect(chatEnd).toHaveLength(1);
    }
  },
  60_000,
);

test.skipIf(!apiKey)(
  "ending a chat tidies the new raw notes into wiki pages with real Gemini",
  async () => {
    // A temp copy of the sample brain: its two raw notes plus this chat's note get tidied.
    const brain = mkdtempSync(join(tmpdir(), "live-agent-smoke-tidy-"));
    cpSync(join(import.meta.dir, "..", "sample-brain"), brain, { recursive: true });
    const session = await startSession({
      // The chat side is scripted: this case smoke-tests the real tidy model.
      model: scriptedModel([[{ type: "text", text: "Got it." }]]),
      config: { ...defaultConfig(), brainPath: brain },
      tidy: geminiTidyModel({ apiKey: apiKey! }),
      summaryTimeoutMs: 50,
    });
    const seen: AgentEvent[] = [];
    session.onEvent((e) => seen.push(e));
    try {
      await session.sendText("My neighbour Tomasz lends me his ladder; he lives at number 12.");
      await session.close();
      let ended: AgentEvent | undefined;
      for (let i = 0; i < 1600 && !ended; i++) {
        ended = seen.find((e) => e.type === "job.state" && e.kind === "tidy" && e.state !== "queued" && e.state !== "running");
        if (!ended) await Bun.sleep(50);
      }
      console.log("  tidy job:", ended);
      expect(ended).toEqual(expect.objectContaining({ state: "done" }));
      const wiki = readdirSync(join(brain, "wiki"));
      console.log("  wiki now:", wiki);
      const all = wiki.map((f) => readFileSync(join(brain, "wiki", f), "utf8")).join("\n");
      expect(all.toLowerCase()).toContain("tomasz");
      expect(readdirSync(join(brain, "raw")).length).toBeGreaterThanOrEqual(3);
    } finally {
      rmSync(brain, { recursive: true, force: true });
    }
  },
  90_000,
);
