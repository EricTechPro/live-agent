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
import { GoogleGenAI } from "@google/genai";
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
  "after the connection drops, the chat carries on over a resumed session",
  async () => {
    // The real Live connect, keeping hold of each socket so the test can cut one.
    const sockets: { close(): void }[] = [];
    const model = geminiLiveModel({
      apiKey: apiKey!,
      connect: async (params) => {
        const ai = new GoogleGenAI({ apiKey: apiKey!, httpOptions: { apiVersion: "v1beta" } });
        const socket = await ai.live.connect(params);
        sockets.push(socket);
        return socket;
      },
    });
    const session = await startSession({ model, tools: [], chatEndNote: false });
    try {
      await session.sendText("Remember the code word: giraffe. Just say OK.");
      await Bun.sleep(1000); // let the server send a resumption handle after the turn
      sockets[0]!.close(); // closed from outside the adapter: looks like a drop
      for (let i = 0; i < 100 && sockets.length < 2; i++) await Bun.sleep(100);
      expect(sockets.length).toBe(2);

      const events = await session.sendText("What was the code word? One word.");
      const done = events.find((e) => e.type === "turn.done");
      console.log("  after reconnect:", done?.reply || "(no transcript)");
      expect(done?.reply.toLowerCase()).toContain("giraffe");
    } finally {
      await session.close();
    }
  },
  60_000,
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
    // without a real CLI installed (the next case uses the real one).
    const dir = mkdtempSync(join(tmpdir(), "live-agent-smoke-"));
    const bin = join(dir, "fake-gemini.sh");
    writeFileSync(
      bin,
      `#!/bin/sh\nsleep 8\necho '{"type":"message","role":"assistant","content":"Fixed the off-by-one bug in counter.ts."}'\necho '{"type":"result","status":"success"}'\n`,
    );
    chmodSync(bin, 0o755);
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

const realGemini = Bun.which("gemini");
if (apiKey && !realGemini) console.log("live smoke: real helper case skipped (gemini not installed)");

test.skipIf(!apiKey || !realGemini)(
  "a real model starts the real Gemini CLI, which fixes an off-by-one bug on disk",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "live-agent-smoke-real-helper-"));
    const project = join(dir, "counter-app");
    mkdirSync(project);
    const buggy = [
      "// Counts from 1 to n, inclusive.",
      "export function countTo(n: number): number[] {",
      "  const out: number[] = [];",
      "  for (let i = 1; i < n; i++) out.push(i);",
      "  return out;",
      "}",
      "",
    ].join("\n");
    writeFileSync(join(project, "counter.ts"), buggy);
    writeFileSync(
      join(project, "counter.test.ts"),
      `import { expect, test } from "bun:test";\nimport { countTo } from "./counter.ts";\ntest("countTo(3)", () => expect(countTo(3)).toEqual([1, 2, 3]));\n`,
    );
    const brain = join(dir, "brain");
    cpSync(join(import.meta.dir, "..", "sample-brain"), brain, { recursive: true });
    const session = await startSession({
      model: geminiLiveModel({ apiKey: apiKey! }), workDir: project, mode: "bypass",
      config: { ...defaultConfig(), brainPath: brain },
      // A throwaway private CLI home; the helper runs on the same key as the voice.
      helpers: { geminiCliBin: realGemini!, geminiCliHome: join(dir, "cli-home") },
    });
    const all: AgentEvent[] = [];
    session.onEvent((e) => all.push(e));
    try {
      const events = await session.sendText(
        "Start a helper to fix the off-by-one bug in counter.ts in this project. Tell me when it is done.",
      );
      expect(events).toContainEqual(expect.objectContaining({ type: "tool.call", name: "start_helper" }));

      const ended = () => all.findIndex((e) => e.type === "job.state" && ["done", "failed", "cancelled"].includes(e.state));
      const announced = () => ended() >= 0 && all.slice(ended()).some((e) => e.type === "transcript" && e.role === "model");
      const deadline = Date.now() + 200_000;
      while (!announced() && Date.now() < deadline) await Bun.sleep(500);
      await Bun.sleep(3000); // let the spoken announcement finish
      const said = all
        .slice(Math.max(ended(), 0))
        .filter((e) => e.type === "transcript" && e.role === "model")
        .map((e) => (e as { text: string }).text)
        .join("");
      console.log("  job states:", all.filter((e) => e.type === "job.state").map((e) => (e as { state: string }).state));
      console.log("  announced: ", said || "(nothing)");

      expect(all[ended()]).toEqual(expect.objectContaining({ type: "job.state", kind: "gemini-cli", state: "done" }));
      expect(said.trim()).not.toBe("");
      const { countTo } = await import(join(project, "counter.ts"));
      expect(countTo(3)).toEqual([1, 2, 3]);
    } finally {
      await session.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
  240_000,
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
