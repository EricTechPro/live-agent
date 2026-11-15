// Speech bubble and transcript polish (ticket 30): model text pieces join with a
// space between sentences, and the bubble shows the latest sentence in full.
import { expect, test } from "bun:test";
import { bubbleLine } from "../app/src/bubble.ts";
import { addToTranscript, emptyTranscript } from "../app/src/transcript.ts";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent } from "../src/core/events.ts";
import { joinText } from "../src/core/join-text.ts";
import { scriptedModel } from "../src/models/scripted.ts";

const feed = (events: AgentEvent[]) => events.reduce(addToTranscript, emptyTranscript).lines;

test("two model segments show with a space between the sentences in the transcript", () => {
  expect(
    feed([
      { type: "transcript", role: "model", text: "Sending that to Claude Code." },
      { type: "transcript", role: "model", text: "May I start it?" },
    ]),
  ).toEqual([{ role: "model", text: "Sending that to Claude Code. May I start it?" }]);
});

test("the turn.done reply has the same space", async () => {
  const model = scriptedModel([
    [
      { type: "text", text: "Sending that to Claude Code." },
      { type: "text", text: "May I start it?" },
    ],
  ]);
  const session = await startSession({ model });
  const events = await session.sendText("ask claude code to fix the test");
  expect(events.at(-1)).toEqual({ type: "turn.done", reply: "Sending that to Claude Code. May I start it?" });
  await session.close();
});

test("chunks inside one word or one sentence join with no extra space", () => {
  expect(joinText("Two", " calls.")).toBe("Two calls.");
  expect(joinText("Clau", "de")).toBe("Claude");
  expect(joinText("open notes.", "md")).toBe("open notes.md");
  expect(joinText("Done.", " Next")).toBe("Done. Next");
  expect(joinText("", "Hi")).toBe("Hi");
  expect(joinText("He said \"go.\"", "Then")).toBe("He said \"go.\" Then");
});

test("the bubble shows the latest sentence in full", () => {
  expect(bubbleLine("Sending that to Claude Code. May I start it?")).toBe("May I start it?");
  expect(bubbleLine("First line.\nSecond line here.")).toBe("Second line here.");
  const long = "Claude Code is fixing the failing login test in your project right now";
  expect(long.length).toBeLessThanOrEqual(80);
  expect(bubbleLine(long, 80)).toBe(long);
});

test("a sentence longer than two lines is cut at a word", () => {
  const long = "Claude Code is fixing the failing login test in your project and will report back soon";
  const line = bubbleLine(long, 40);
  expect(line).toBe("Claude Code is fixing the failing login…");
  expect(line.length).toBeLessThanOrEqual(40);
  expect(bubbleLine("a".repeat(50), 20)).toBe(`${"a".repeat(19)}…`);
});
