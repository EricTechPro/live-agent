// The window's live transcript: chunks from the core joined into lines.
import { expect, test } from "bun:test";
import { addToTranscript, emptyTranscript } from "../app/src/transcript.ts";
import type { AgentEvent } from "../src/core/events.ts";

const feed = (events: AgentEvent[]) => events.reduce(addToTranscript, emptyTranscript).lines;

test("chunks from the same speaker join into one line; a new speaker starts a new line", () => {
  expect(
    feed([
      { type: "transcript", role: "user", text: "what's on" },
      { type: "transcript", role: "user", text: " today?" },
      { type: "transcript", role: "model", text: "Two" },
      { type: "transcript", role: "model", text: " calls." },
      { type: "turn.done", reply: "Two calls." },
      { type: "transcript", role: "user", text: "thanks" },
    ]),
  ).toEqual([
    { role: "user", text: "what's on today?" },
    { role: "model", text: "Two calls." },
    { role: "user", text: "thanks" },
  ]);
});

test("a finished turn closes the line, so the next reply starts fresh", () => {
  expect(
    feed([
      { type: "transcript", role: "model", text: "One." },
      { type: "turn.done", reply: "One." },
      { type: "transcript", role: "model", text: "Two." },
    ]),
  ).toEqual([
    { role: "model", text: "One." },
    { role: "model", text: "Two." },
  ]);
});

test("an interruption and an error show as their own lines", () => {
  expect(
    feed([
      { type: "transcript", role: "model", text: "The long" },
      { type: "interrupted" },
      { type: "error", message: "network blip" },
    ]),
  ).toEqual([
    { role: "model", text: "The long" },
    { role: "note", text: "(interrupted)" },
    { role: "note", text: "error: network blip" },
  ]);
});

test("a new chat starts a clean transcript with a note saying so", () => {
  expect(
    feed([
      { type: "transcript", role: "user", text: "old chat" },
      { type: "turn.done", reply: "" },
      { type: "chat.started" },
    ]),
  ).toEqual([{ role: "note", text: "New chat. The last one was saved to your brain." }]);
});
