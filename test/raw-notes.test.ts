// Fast tests for raw notes, through the agent core's event stream.
// Two ways a raw note gets written:
//   1. "remember this": the model calls the `remember` tool mid-chat.
//   2. chat end: `session.close()` writes one short note about the chat.
// Every test uses its own temp brain, never the repo's sample brain.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveRawNote } from "../src/brain/index.ts";
import { defaultConfig } from "../src/config/index.ts";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent } from "../src/core/events.ts";
import type { Model, ModelInput } from "../src/core/model.ts";
import { scriptedModel } from "../src/models/scripted.ts";

const brains: string[] = [];
afterEach(() => {
  for (const dir of brains.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempBrain() {
  const dir = mkdtempSync(join(tmpdir(), "live-agent-raw-"));
  brains.push(dir);
  return dir;
}

const rawFiles = (brain: string) => (existsSync(join(brain, "raw")) ? readdirSync(join(brain, "raw")).sort() : []);
const writes = (events: AgentEvent[]) => events.filter((e) => e.type === "brain.write");

describe("remember this", () => {
  test("saying 'remember this' writes a raw note right away and reports it", async () => {
    const brain = tempBrain();
    const model = scriptedModel([
      [{ type: "tool.call", id: "r1", name: "remember", args: { title: "Gate code", text: "The garden gate code is 4512." } }],
      [{ type: "text", text: "Saved." }],
    ]);
    const session = await startSession({ model, config: { ...defaultConfig(), brainPath: brain } });

    const events = await session.sendText("Remember this: the garden gate code is 4512.");

    const files = rawFiles(brain);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}-gate-code\.md$/);
    expect(readFileSync(join(brain, "raw", files[0]!), "utf8")).toContain("The garden gate code is 4512.");
    expect(writes(events)).toEqual([{ type: "brain.write", path: `raw/${files[0]}`, cause: "tool", tool: "remember" }]);
    // Written before the turn ended: "right away", not at chat end.
    expect(events.at(-1)?.type).toBe("turn.done");
    await session.close();
  });

  test("remember is an edit: in Ask me mode it waits for a yes, in Auto edits it just runs", async () => {
    const brain = tempBrain();
    const config = { ...defaultConfig(), brainPath: brain };
    const call = [{ type: "tool.call" as const, id: "r1", name: "remember", args: { text: "Call mum on Sunday." } }];

    const asking = await startSession({ model: scriptedModel([call, [{ type: "text", text: "Shall I save it?" }]]), config, mode: "ask-me" });
    const asked = await asking.sendText("Remember to call mum on Sunday.");
    expect(asked).toContainEqual(expect.objectContaining({ type: "safety.verdict", name: "remember", risk: "edit", verdict: "ask" }));
    expect(rawFiles(brain)).toEqual([]);

    const auto = await startSession({ model: scriptedModel([call, [{ type: "text", text: "Saved." }]]), config, mode: "auto-edits" });
    const ran = await auto.sendText("Remember to call mum on Sunday.");
    expect(ran).toContainEqual(expect.objectContaining({ type: "safety.verdict", name: "remember", verdict: "allow" }));
    expect(rawFiles(brain)).toHaveLength(1);
  });
});

describe("raw note files", () => {
  test("a new note never overwrites an existing raw note with the same name", async () => {
    const brain = tempBrain();
    const date = new Date(2026, 10, 13);
    mkdirSync(join(brain, "raw"));
    writeFileSync(join(brain, "raw", "2026-11-13-chat.md"), "older note");

    const first = await saveRawNote(brain, { title: "Chat", text: "new one", date });
    const second = await saveRawNote(brain, { title: "Chat", text: "newer one", date });

    expect(first).toBe("raw/2026-11-13-chat-2.md");
    expect(second).toBe("raw/2026-11-13-chat-3.md");
    expect(readFileSync(join(brain, "raw", "2026-11-13-chat.md"), "utf8")).toBe("older note");
  });
});

describe("chat end", () => {
  // The fake answers the summary request with a summary, so the test proves
  // the model's summary (not just the transcript) lands in the note.
  function chatThenSummary() {
    return scriptedModel([
      [{ type: "text", text: "Tomatoes like six hours of sun." }],
      (input: ModelInput) => [
        { type: "text", text: input.type === "text" && /summar/i.test(input.text) ? "- Asked about tomato sun. Decided: move pots south." : "?" },
      ],
    ]);
  }

  test("ending a session writes exactly one raw note with the model's summary", async () => {
    const brain = tempBrain();
    const session = await startSession({ model: chatThenSummary(), config: { ...defaultConfig(), brainPath: brain } });
    const seen: AgentEvent[] = [];
    session.onEvent((e) => seen.push(e));
    await session.sendText("How much sun do tomatoes need?");

    await session.close();

    const files = rawFiles(brain);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}-chat\.md$/);
    expect(readFileSync(join(brain, "raw", files[0]!), "utf8")).toContain("Decided: move pots south.");
    expect(writes(seen)).toEqual([{ type: "brain.write", path: `raw/${files[0]}`, cause: "chat-end" }]);
    // The summary request is the core's own business: it is not shown as chat.
    expect(seen.filter((e) => e.type === "transcript").map((e) => e.type === "transcript" && e.text)).toEqual([
      "How much sun do tomatoes need?",
      "Tomatoes like six hours of sun.",
    ]);
  });

  test("a spoken summary (audio alongside the text, as Gemini Live sends it) still lands in the note", async () => {
    const brain = tempBrain();
    const voice = { type: "audio", data: new Int16Array([1, 2]), sampleRate: 24000 } as const;
    const model = scriptedModel([
      [voice, { type: "text", text: "Tomatoes like six hours of sun." }],
      [voice, { type: "text", text: "- Decided: move pots south." }, voice],
    ]);
    const session = await startSession({ model, config: { ...defaultConfig(), brainPath: brain } });
    await session.sendText("How much sun do tomatoes need?");
    const afterClose: AgentEvent[] = [];
    session.onEvent((e) => afterClose.push(e));
    await session.close();
    const files = rawFiles(brain);
    expect(files).toHaveLength(1);
    const note = readFileSync(join(brain, "raw", files[0]!), "utf8");
    expect(note).toContain("Decided: move pots south.");
    expect(note).not.toContain("- You:"); // the model's summary, not the transcript fallback
    // The summary never shows up as chat.
    expect(afterClose.map((e) => e.type)).toEqual(["brain.write"]);
  });

  test("if the summary request fails, the note falls back to the plain transcript", async () => {
    const brain = tempBrain();
    // The script has no entry for the summary request, so the fake reports an error.
    const session = await startSession({
      model: scriptedModel([[{ type: "text", text: "Tomatoes like six hours of sun." }]]),
      config: { ...defaultConfig(), brainPath: brain },
    });
    await session.sendText("How much sun do tomatoes need?");

    await session.close();

    const files = rawFiles(brain);
    expect(files).toHaveLength(1);
    const note = readFileSync(join(brain, "raw", files[0]!), "utf8");
    expect(note).toContain("How much sun do tomatoes need?");
    expect(note).toContain("Tomatoes like six hours of sun.");
  });

  test("an unreachable model does not hold up close, and the note is still written", async () => {
    const brain = tempBrain();
    // Answers the chat turn, then goes quiet forever.
    let answered = false;
    const model: Model = {
      async connect(onEvent) {
        return {
          sendText() {
            if (answered) return;
            answered = true;
            queueMicrotask(() => {
              onEvent({ type: "text", text: "Hi Eric." });
              onEvent({ type: "turn.complete" });
            });
          },
          sendToolResponse() {},
          sendAudio() {},
          async close() {},
        };
      },
    };
    const session = await startSession({ model, config: { ...defaultConfig(), brainPath: brain }, summaryTimeoutMs: 50 });
    await session.sendText("hello");

    const started = Date.now();
    await session.close();

    expect(Date.now() - started).toBeLessThan(1000);
    expect(rawFiles(brain)).toHaveLength(1);
    expect(readFileSync(join(brain, "raw", rawFiles(brain)[0]!), "utf8")).toContain("Hi Eric.");
  });

  test("tests on the default config never write into the repo's sample brain", async () => {
    const repoRaw = join(import.meta.dir, "..", "sample-brain", "raw");
    const before = readdirSync(repoRaw).sort();
    const session = await startSession({ model: scriptedModel([[{ type: "text", text: "Hi." }]]) });
    const seen: AgentEvent[] = [];
    session.onEvent((e) => seen.push(e));
    await session.sendText("hello");

    await session.close();

    expect(writes(seen)).toHaveLength(1);
    expect(readdirSync(repoRaw).sort()).toEqual(before);
  });

  test("a session where nothing was said writes no note", async () => {
    const brain = tempBrain();
    const session = await startSession({ model: scriptedModel([]), config: { ...defaultConfig(), brainPath: brain } });

    await session.close();

    expect(rawFiles(brain)).toEqual([]);
  });
  test("a spoken turn goes into the chat-end note too", async () => {
    const brain = tempBrain();
    const session = await startSession({
      model: scriptedModel([[{ type: "user.text", text: "what is " }, { type: "user.text", text: "the gate code" }, { type: "text", text: "It is 4512." }]]),
      config: { ...defaultConfig(), brainPath: brain },
      tools: [],
    });
    const done = new Promise<void>((resolve) => session.onEvent((e) => e.type === "turn.done" && resolve()));
    session.sendAudio(new Int16Array(160), 16000);
    await done;
    await session.close();
    const files = readdirSync(join(brain, "raw"));
    expect(files.length).toBe(1);
    const note = readFileSync(join(brain, "raw", files[0]!), "utf8");
    expect(note).toContain("- You: what is the gate code");
    expect(note).toContain("- Agent: It is 4512.");
  });
});
