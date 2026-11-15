// Ticket 35: `draw_diagram` is retired. Mermaid is a `diagram` mark on the canvas:
// a card placed on the board, drawn with the pen frame, the diagram inside.
// Core side through the event stream; window side through the pure sketch module.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { startSession } from "../src/core/agent.ts";
import type { Mark } from "../src/core/canvas.ts";
import type { AgentEvent, EventOf } from "../src/core/events.ts";
import type { ModelEvent } from "../src/core/model.ts";
import { bundledTools } from "../src/core/bundled-tools.ts";
import { loadTools } from "../src/core/registry.ts";
import { systemInstruction } from "../src/core/tone.ts";
import { scriptedModel } from "../src/models/scripted.ts";
import { addCanvasEvent, cardBox, diagramCards, emptyScene, fitBoard, inkFor } from "../app/src/sketch.ts";
import { drawsOnCanvas } from "../app/src/cues.ts";

const tools = await loadTools();
const root = resolve(import.meta.dir, "..");
const source = "flowchart LR\n  mic --> core --> voice";
const card = { kind: "diagram", id: "p1", x: 100, y: 80, w: 500, h: 300, title: "How it works", source };
const call = (id: string, name: string, args: Record<string, unknown>): ModelEvent => ({ type: "tool.call", id, name, args });

async function oneTurn(first: ModelEvent[]) {
  const s = await startSession({ model: scriptedModel([first, [{ type: "text", text: "There." }]]), tools, mode: "ask-me", chatEndNote: false });
  const events = await s.sendText("Draw how this works");
  await s.close();
  return events;
}
const result = (events: AgentEvent[], id: string) => events.find((e): e is EventOf<"tool.result"> => e.type === "tool.result" && e.id === id)!;

test("draw accepts a diagram mark and emits it in canvas.beat, source and title as sent", async () => {
  const events = await oneTurn([call("d1", "draw", { beats: [{ say: "Here is how it flows.", marks: [card] }] })]);
  const beat = events.find((e): e is EventOf<"canvas.beat"> => e.type === "canvas.beat")!;
  expect(beat.marks).toEqual([card as Mark]);
  expect(result(events, "d1").status).toBe("ok");
});

const bad: [string, Record<string, unknown>, string][] = [
  ["empty source", { ...card, source: "  " }, "source"],
  ["no source", { ...card, source: undefined }, "source"],
  ["off the board", { ...card, x: 700 }, "off the board"],
  ["too small to read", { ...card, w: 40, h: 30 }, "w"],
];
for (const [name, mark, hint] of bad) {
  test(`a bad diagram mark (${name}) is an error the model hears, and nothing is drawn`, async () => {
    const events = await oneTurn([call("d1", "draw", { beats: [{ say: "Here.", marks: [mark] }] })]);
    expect(events.some((e) => e.type.startsWith("canvas."))).toBe(false);
    expect(result(events, "d1")).toMatchObject({ status: "error", error: expect.stringContaining(hint) });
  });
}

test("the draw schema stays flat and lists the diagram fields", () => {
  const draw = tools.find((t) => t.name === "draw")!;
  const schema = JSON.stringify(draw.parameters);
  expect(schema).not.toMatch(/anyOf|oneOf|allOf|"const"|\$ref/);
  expect(schema).toContain('"diagram"');
  expect(schema).toContain('"source"');
  expect(schema).toContain('"title"');
});

test("edit_canvas can retitle, recolour and move a diagram card", async () => {
  const s = await startSession({
    model: scriptedModel([
      [call("d1", "draw", { beats: [{ say: "Here.", marks: [card] }] })], [{ type: "text", text: "ok" }],
      [call("e1", "edit_canvas", { edits: [{ id: "p1", label: "The flow", color: "blue", x: 300 }] })], [{ type: "text", text: "ok" }],
    ]),
    tools, mode: "bypass", chatEndNote: false,
  });
  await s.sendText("draw");
  const events = await s.sendText("retitle it");
  const edit = events.find((e): e is EventOf<"canvas.edit"> => e.type === "canvas.edit")!;
  expect(edit.mark).toEqual({ ...card, title: "The flow", color: "blue", x: 300 } as Mark);
  await s.close();
});

test("draw_diagram, its showDiagram hook, the diagram event and the old panel are gone", async () => {
  expect(tools.some((t) => t.name === "draw_diagram")).toBe(false);
  expect(bundledTools.some((t) => t.name === "draw_diagram")).toBe(false);
  for (const file of ["tools/draw-diagram.ts", "app/src/diagram-view.ts", "app/src/diagram.ts", "test/diagram.test.ts"]) {
    expect(existsSync(resolve(root, file))).toBe(false);
  }
  for (const file of ["src/core/tool.ts", "src/core/tool-calls.ts", "src/core/events.ts", "app/src/main.ts", "app/index.html"]) {
    const text = await Bun.file(resolve(root, file)).text();
    expect(text).not.toContain("showDiagram");
    expect(text).not.toContain('type: "diagram"');
    expect(text).not.toContain("mountDiagram");
    expect(text).not.toContain('id="diagram"');
  }
  // A call to the old name is refused like any unknown tool.
  const events = await oneTurn([call("d1", "draw_diagram", { source })]);
  expect(result(events, "d1").status).toBe("blocked");
});

test("the README tool table and the system prompt name draw, not draw_diagram", async () => {
  const readme = await Bun.file(resolve(root, "README.md")).text();
  expect(readme).not.toContain("draw_diagram");
  expect(readme).toMatch(/\| read \|[^\n]*`draw`[^\n]*`edit_canvas`/);
  const prompt = systemInstruction("short", { brainPath: "/brain" });
  expect(prompt).not.toContain("draw_diagram");
  expect(prompt).toContain("diagram");
});

// ---- window: the card --------------------------------------------------------

test("a diagram card draws a pen frame (4 sides) with its title written inside", () => {
  const ink = inkFor(card as Mark);
  expect(ink.parts.filter((p) => p.kind === "stroke")).toHaveLength(4);
  expect(ink.parts.at(-1)).toMatchObject({ kind: "text", text: "How it works" });
  expect(inkFor({ ...card, title: undefined } as Mark).parts.filter((p) => p.kind === "text")).toEqual([]);
});

test("the scene lists its diagram cards, edits and erases included", () => {
  const beat: AgentEvent = { type: "canvas.beat", id: "d1", beat: 0, say: "Here.", marks: [card as Mark, { kind: "check", id: "p2", x: 900, y: 100 }] };
  let scene = addCanvasEvent(emptyScene, beat);
  expect(diagramCards(scene).map((m) => m.id)).toEqual(["p1"]);
  scene = addCanvasEvent(scene, { type: "canvas.edit", id: "e1", change: { label: "New" }, mark: { ...card, title: "New" } as Mark });
  expect(diagramCards(scene)[0]!.title).toBe("New");
  scene = addCanvasEvent(scene, { type: "canvas.erase", id: "e2", ids: ["p1"], all: false });
  expect(diagramCards(scene)).toEqual([]);
});

test("the card's diagram sits inside the frame, below the title, scaled with the board", () => {
  const fit = fitBoard(500, 300); // half size
  const box = cardBox(card as Mark & { kind: "diagram" }, fit);
  expect(box.left).toBeGreaterThan(fit.x + 100 * 0.5);
  expect(box.top).toBeGreaterThan(fit.y + 80 * 0.5);
  expect(box.left + box.width).toBeLessThan(fit.x + 600 * 0.5);
  expect(box.top + box.height).toBeLessThan(fit.y + 380 * 0.5);
  const untitled = cardBox({ ...card, title: undefined } as Mark & { kind: "diagram" }, fit);
  expect(untitled.top).toBeLessThan(box.top);
});

test("a canvas event shows the drawing on screen (the old diagram event is gone)", () => {
  expect(drawsOnCanvas({ type: "canvas.beat" })).toBe(true);
  expect(drawsOnCanvas({ type: "diagram" })).toBe(false);
});
