// Ticket 34, core side: the core marks which beat is being spoken. As the model's
// output transcript reaches the start of a beat's `say` line, it emits
// `canvas.speak` with that beat, so the window can start its strokes with the words.
import { expect, test } from "bun:test";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent } from "../src/core/events.ts";
import type { ModelEvent } from "../src/core/model.ts";
import { loadTools } from "../src/core/registry.ts";
import { scriptedModel } from "../src/models/scripted.ts";

const tools = await loadTools();
const draw = (id: string, beats: unknown): ModelEvent => ({ type: "tool.call", id, name: "draw", args: { beats } });
const text = (...chunks: string[]): ModelEvent[] => chunks.map((t) => ({ type: "text", text: t }));
const twoBeats = [
  { say: "The mic sends your voice to the core.", marks: [{ kind: "box", id: "p1", x: 40, y: 200, w: 200, h: 100, label: "Mic" }] },
  {
    say: "Then it answers out loud!",
    marks: [
      { kind: "box", id: "p2", x: 400, y: 200, w: 200, h: 100, label: "Core" },
      { kind: "arrow", id: "p3", from: { x: 240, y: 250 }, to: { x: 400, y: 250 } },
    ],
  },
];
const speaks = (events: AgentEvent[]) => events.filter((e) => e.type === "canvas.speak");

async function run(script: ModelEvent[][], ...turns: string[]) {
  const s = await startSession({ model: scriptedModel(script), tools, mode: "bypass", chatEndNote: false });
  const out: AgentEvent[][] = [];
  for (const t of turns) out.push(await s.sendText(t));
  await s.close();
  return out;
}

test("each beat's canvas.speak comes as the transcript reaches the start of its line", async () => {
  const [events] = await run([[draw("d1", twoBeats)], text("The mic sends", " your voice to the core.", " Then it", " answers out loud!")], "draw it");
  expect(speaks(events!)).toEqual([
    { type: "canvas.speak", id: "d1", beat: 0 },
    { type: "canvas.speak", id: "d1", beat: 1 },
  ]);
  // Right after the chunk that started each line, before the next chunk.
  const order = events!.flatMap((e) => (e.type === "transcript" && e.role === "model" ? [e.text] : e.type === "canvas.speak" ? [`<speak ${e.beat}>`] : []));
  expect(order).toEqual(["The mic sends", "<speak 0>", " your voice to the core.", " Then it", " answers out loud!", "<speak 1>"]);
});

test("matching ignores case and punctuation", async () => {
  const [events] = await run([[draw("d1", twoBeats)], text("the MIC, sends... your voice. THEN, it answers")], "draw it");
  expect(speaks(events!).map((e) => (e.type === "canvas.speak" ? e.beat : -1))).toEqual([0, 1]);
});

test("a line the voice skipped or reworded still gets its signal, in order, when a later line starts", async () => {
  const [events] = await run([[draw("d1", twoBeats)], text("So, basically: then it answers out loud.")], "draw it");
  expect(speaks(events!).map((e) => (e.type === "canvas.speak" ? e.beat : -1))).toEqual([0, 1]);
});

test("a turn whose words never match its lines still draws every beat, with no speak signal", async () => {
  const [events] = await run([[draw("d1", twoBeats)], text("Here you go.")], "draw it");
  expect(events!.filter((e) => e.type === "canvas.beat")).toHaveLength(2);
  expect(speaks(events!)).toEqual([]);
});

test("beats left unspoken at turn end are not signalled by a later turn's words", async () => {
  const [, second] = await run([[draw("d1", twoBeats)], text("Here."), text("The mic sends your voice.")], "draw it", "and?");
  expect(speaks(second!)).toEqual([]);
});

test("an interruption erases the beats not yet spoken, so the canvas keeps only what was said", async () => {
  const [first, second] = await run(
    [
      [draw("d1", twoBeats)],
      [...text("The mic sends your voice"), { type: "interrupted" }],
      // p2 and p3 are free again: a new draw may use them.
      [draw("d2", [{ say: "Again.", marks: [{ kind: "check", id: "p2", x: 900, y: 100 }] }])],
      text("Again."),
    ],
    "draw it",
    "draw again",
  );
  const at = (match: (e: AgentEvent) => boolean) => first!.findIndex(match);
  expect(first).toContainEqual({ type: "canvas.erase", id: "d1", ids: ["p2", "p3"], all: false });
  expect(at((e) => e.type === "interrupted")).toBeLessThan(at((e) => e.type === "canvas.erase"));
  expect(second!.filter((e) => e.type === "canvas.beat")).toHaveLength(1);
});

test("an interruption after every line was spoken erases nothing", async () => {
  const [events] = await run([[draw("d1", twoBeats)], [...text("The mic sends. Then it answers."), { type: "interrupted" }]], "draw it");
  expect(events!.filter((e) => e.type === "canvas.erase")).toEqual([]);
});
