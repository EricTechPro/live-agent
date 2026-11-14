// Fast tests for the brain, through the agent core's event stream.
// The scripted fake model calls search_brain; the core gates and runs it, the
// fake answers from what came back, and the core reports the notes used.
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig } from "../src/config/index.ts";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent } from "../src/core/events.ts";
import type { ModelInput } from "../src/core/model.ts";
import { scriptedModel } from "../src/models/scripted.ts";

// The fake answers with the first note's content, so a test proves the note
// really reached the model.
function answerFromNotes(input: ModelInput) {
  if (input.type !== "tool.response") return [{ type: "text" as const, text: "no notes" }];
  const output = input.response.output as { notes?: { path: string; content: string }[] } | undefined;
  const first = output?.notes?.[0];
  return [{ type: "text" as const, text: first ? `From ${first.path}: ${first.content}` : "nothing found" }];
}

function askBrain(query: string) {
  return scriptedModel([
    [{ type: "tool.call", id: "b1", name: "search_brain", args: { query } }],
    answerFromNotes,
  ]);
}

const notesUsed = (events: AgentEvent[]) => events.filter((e) => e.type === "notes.used");

describe("brain", () => {
  test("a question answerable from the sample wiki gets an answer and a notes-used event", async () => {
    const session = await startSession({ model: askBrain("how often do I feed my sourdough starter"), config: defaultConfig() });

    const events = await session.sendText("How often do I feed my sourdough starter?");

    expect(notesUsed(events)).toEqual([{ type: "notes.used", notes: ["wiki/sourdough-starter.md"] }]);
    const done = events.at(-1);
    expect(done?.type).toBe("turn.done");
    expect(done?.type === "turn.done" && done.reply).toContain("Feed Gus once a day");
    // notes.used comes before the turn ends, so the app can show it with the answer.
    expect(events.at(-2)?.type).toBe("notes.used");
    await session.close();
  });

  test("pointing the config at another folder makes the agent read that folder instead", async () => {
    const other = mkdtempSync(join(tmpdir(), "live-agent-brain-"));
    try {
      mkdirSync(join(other, "projects"));
      writeFileSync(join(other, "projects", "sourdough-bakery.md"), "Open a tiny sourdough bakery in the garage.");
      const config = { ...defaultConfig(), brainPath: other };
      const session = await startSession({ model: askBrain("sourdough"), config });

      const events = await session.sendText("What is my sourdough plan?");

      expect(notesUsed(events)).toEqual([{ type: "notes.used", notes: ["projects/sourdough-bakery.md"] }]);
      expect(events.at(-1)).toEqual({
        type: "turn.done",
        reply: "From projects/sourdough-bakery.md: Open a tiny sourdough bakery in the garage.",
      });
      await session.close();
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  test("answers come from wiki and projects, never from raw", async () => {
    // "panniers" is in raw/ and projects/; only the project note may be used.
    const session = await startSession({ model: askBrain("panniers"), config: defaultConfig() });

    const events = await session.sendText("Who lends me panniers?");

    expect(notesUsed(events)).toEqual([{ type: "notes.used", notes: ["projects/portugal-bike-trip.md"] }]);
    await session.close();
  });

  test("reading the brain is a read-class tool and never asks, even in Ask me mode", async () => {
    const session = await startSession({ model: askBrain("tomato garden"), config: defaultConfig(), mode: "ask-me" });

    const events = await session.sendText("When do I water the tomatoes?");

    expect(events).toContainEqual(expect.objectContaining({ type: "tool.call", name: "search_brain", risk: "read" }));
    expect(events.filter((e) => e.type === "safety.verdict").map((e) => e.type === "safety.verdict" && e.verdict)).toEqual(["allow"]);
    expect(notesUsed(events)).toEqual([{ type: "notes.used", notes: ["wiki/tomato-garden.md"] }]);
    await session.close();
  });

  test("a turn that uses no notes sends no notes-used event", async () => {
    const session = await startSession({ model: scriptedModel([[{ type: "text", text: "Hi!" }]]), config: defaultConfig() });

    expect(notesUsed(await session.sendText("hello"))).toEqual([]);
    await session.close();
  });

  test("a real brain folder is ignored by git, the sample brain is not", () => {
    // cwd: the repo (test/preload.ts moves the working folder to a temp copy).
    const cwd = join(import.meta.dir, "..");
    const ignored = (path: string) => Bun.spawnSync(["git", "check-ignore", "-q", path], { cwd }).exitCode === 0;
    expect(ignored("brain/wiki/secret.md")).toBe(true);
    expect(ignored("sample-brain/wiki/sourdough-starter.md")).toBe(false);
  });
});
