// Ticket 33: later turns change the canvas by mark id ("make p2 red", "erase p3",
// "clear the board") with the `edit_canvas` tool, through the core's event stream.
// The core keeps the chat's marks, so it can refuse an unknown id before
// anything reaches the window.
import { expect, test } from "bun:test";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent, EventOf } from "../src/core/events.ts";
import type { ModelEvent } from "../src/core/model.ts";
import { bundledTools } from "../src/core/bundled-tools.ts";
import { loadTools } from "../src/core/registry.ts";
import { systemInstruction } from "../src/core/tone.ts";
import { scriptedModel } from "../src/models/scripted.ts";

const tools = await loadTools();
const call = (id: string, name: string, args: Record<string, unknown>): ModelEvent[] => [{ type: "tool.call", id, name, args }];
const say = (text: string): ModelEvent[] => [{ type: "text", text }];
const canvasEvents = (events: AgentEvent[]) => events.filter((e) => e.type.startsWith("canvas."));
const result = (events: AgentEvent[], id: string) =>
  events.find((e): e is EventOf<"tool.result"> => e.type === "tool.result" && e.id === id)!;

const sketch = [
  {
    say: "Mic, core, voice.",
    marks: [
      { kind: "box", id: "p1", x: 40, y: 200, w: 200, h: 100, label: "Mic" },
      { kind: "box", id: "p2", x: 400, y: 200, w: 200, h: 100, label: "Core" },
      { kind: "arrow", id: "p3", from: { x: 240, y: 250 }, to: { x: 400, y: 250 } },
      { kind: "check", id: "p4", x: 900, y: 100 },
    ],
  },
];

/** A session that has drawn the sketch, then runs one edit_canvas call per later turn. */
async function afterSketch(...edits: Record<string, unknown>[]) {
  const script = [call("d1", "draw", { beats: sketch }), say("Drawn.")];
  edits.forEach((args, i) => script.push(call(`e${i + 1}`, "edit_canvas", args), say("Done.")));
  const s = await startSession({ model: scriptedModel(script), tools, mode: "ask-me", chatEndNote: false });
  const drawn = await s.sendText("draw it");
  const turns: AgentEvent[][] = [];
  for (let i = 0; i < edits.length; i++) turns.push(await s.sendText(`edit ${i + 1}`));
  return { s, drawn, turns };
}

test("edit_canvas is a read tool with a flat schema, in tools/ and in the bundled list", () => {
  const tool = tools.find((t) => t.name === "edit_canvas")!;
  expect(tool.risk).toBe("read");
  expect(bundledTools.some((t) => t.name === "edit_canvas")).toBe(true);
  expect(JSON.stringify(tool.parameters)).not.toMatch(/anyOf|oneOf|allOf|"const"|\$ref/);
});

test("the draw result lists every id on the canvas, so the model can refer to them later", async () => {
  const { s, drawn } = await afterSketch();
  expect(result(drawn, "d1").output).toMatchObject({ canvas: ["p1", "p2", "p3", "p4"] });
  await s.close();
});

test("'make p2 red' emits canvas.edit with the change and the whole changed mark", async () => {
  const { s, turns } = await afterSketch({ edits: [{ id: "p2", color: "red", label: "Brain" }] });
  const [edit] = canvasEvents(turns[0]!) as EventOf<"canvas.edit">[];
  expect(edit).toEqual({
    type: "canvas.edit", id: "e1", change: { color: "red", label: "Brain" },
    mark: { kind: "box", id: "p2", x: 400, y: 200, w: 200, h: 100, label: "Brain", color: "red" },
  });
  expect(result(turns[0]!, "e1")).toMatchObject({ status: "ok", output: { edited: ["p2"], erased: [], canvas: ["p1", "p2", "p3", "p4"] } });
  await s.close();
});

test("a move keeps the mark's shape: a box moves its corner, an arrow moves both ends together", async () => {
  const { s, turns } = await afterSketch({ edits: [{ id: "p1", x: 60, y: 400 }, { id: "p3", y: 350 }] });
  const marks = (canvasEvents(turns[0]!) as EventOf<"canvas.edit">[]).map((e) => e.mark);
  expect(marks[0]).toMatchObject({ id: "p1", x: 60, y: 400, w: 200, h: 100 });
  expect(marks[1]).toMatchObject({ id: "p3", from: { x: 240, y: 350 }, to: { x: 400, y: 350 } });
  await s.close();
});

test("edits stick: a later edit builds on the earlier one", async () => {
  const { s, turns } = await afterSketch({ edits: [{ id: "p2", color: "red" }] }, { edits: [{ id: "p2", x: 500 }] });
  const [second] = canvasEvents(turns[1]!) as EventOf<"canvas.edit">[];
  expect(second!.mark).toMatchObject({ id: "p2", x: 500, color: "red" });
  await s.close();
});

test("'erase p3' emits canvas.erase, and the id is gone from the canvas", async () => {
  const { s, turns } = await afterSketch({ erase: ["p3"] }, { edits: [{ id: "p3", color: "red" }] });
  expect(canvasEvents(turns[0]!)).toEqual([{ type: "canvas.erase", id: "e1", ids: ["p3"], all: false }]);
  expect(result(turns[0]!, "e1").output).toMatchObject({ erased: ["p3"], canvas: ["p1", "p2", "p4"] });
  // p3 is gone now, so editing it is refused.
  expect(canvasEvents(turns[1]!)).toEqual([]);
  expect(result(turns[1]!, "e2")).toMatchObject({ status: "error", error: expect.stringContaining("p3 is not on the canvas") });
  await s.close();
});

test("'clear the board' (erase all) erases every mark, and the ids are free again", async () => {
  const { s, turns } = await afterSketch({ erase: ["all"] });
  expect(canvasEvents(turns[0]!)).toEqual([{ type: "canvas.erase", id: "e1", ids: ["p1", "p2", "p3", "p4"], all: true }]);
  expect(result(turns[0]!, "e1").output).toMatchObject({ canvas: [] });
  await s.close();
});

test("one call can edit and erase: edits first, then erases", async () => {
  const { s, turns } = await afterSketch({ edits: [{ id: "p2", color: "red" }], erase: ["p3"] });
  expect(canvasEvents(turns[0]!).map((e) => e.type)).toEqual(["canvas.edit", "canvas.erase"]);
  await s.close();
});

const refused: [string, Record<string, unknown>, string][] = [
  ["unknown id in an edit", { edits: [{ id: "p2", color: "red" }, { id: "p9", color: "red" }] }, "p9 is not on the canvas (it has p1, p2, p3, p4)"],
  ["unknown id in an erase", { erase: ["p3", "p7"] }, "p7 is not on the canvas"],
  ["nothing to change", { edits: [{ id: "p2" }] }, "nothing to change"],
  ["no edits and no erase", {}, "edits or erase"],
  ["a label on a mark that has none", { edits: [{ id: "p4", label: "ok" }] }, "p4 is a check: it has no label"],
  ["an unknown id given as the only edit", { edits: [{ id: "p5", label: "x" }] }, "p5 is not on the canvas"],
  ["a colour that is not a pen", { edits: [{ id: "p2", color: "pink" }] }, "color"],
];

for (const [name, args, hint] of refused) {
  test(`a refused edit (${name}) is an error the model hears, and nothing is emitted`, async () => {
    const { s, turns } = await afterSketch(args);
    expect(canvasEvents(turns[0]!)).toEqual([]);
    expect(result(turns[0]!, "e1")).toMatchObject({ status: "error", error: expect.stringContaining(hint) });
    await s.close();
  });
}

test("a refused call changes nothing: the good edit in it did not stick either", async () => {
  const { s, turns } = await afterSketch({ edits: [{ id: "p2", color: "red" }, { id: "p9", color: "red" }] }, { edits: [{ id: "p2", x: 500 }] });
  const [later] = canvasEvents(turns[1]!) as EventOf<"canvas.edit">[];
  expect(later!.mark.color).toBeUndefined();
  await s.close();
});

test("a new chat empties the canvas: old ids are unknown", async () => {
  const s = await startSession({
    model: scriptedModel([call("d1", "draw", { beats: sketch }), say("ok"), call("e1", "edit_canvas", { erase: ["p1"] }), say("no")]),
    tools, mode: "bypass", chatEndNote: false,
  });
  await s.sendText("draw");
  await s.newChat();
  const events = await s.sendText("erase p1");
  expect(canvasEvents(events)).toEqual([]);
  expect(result(events, "e1").error).toContain("p1 is not on the canvas (it is empty)");
  await s.close();
});

test("the system prompt tells the model to change marks by id with edit_canvas", () => {
  expect(systemInstruction("short", { brainPath: "/brain" })).toContain("edit_canvas");
});
