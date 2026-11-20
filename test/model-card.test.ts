// The 3D "model" card (ticket 42): draw makes it from a small built-in set of shapes, checked
// with Zod like every card, and the prompt tells the model when to use it.
import { expect, test } from "bun:test";
import { startSession } from "../src/core/agent.ts";
import { MODEL_SHAPES } from "../src/core/canvas.ts";
import type { AgentEvent, EventOf } from "../src/core/events.ts";
import { loadTools } from "../src/core/registry.ts";
import { systemInstruction } from "../src/core/tone.ts";
import { scriptedModel } from "../src/models/scripted.ts";

const tools = await loadTools();
const beats = (events: AgentEvent[]) => events.filter((e): e is EventOf<"canvas.beat"> => e.type === "canvas.beat");

async function drawOne(mark: Record<string, unknown>) {
  const model = scriptedModel([
    [{ type: "tool.call", id: "d1", name: "draw", args: { beats: [{ say: "Here it is.", marks: [mark] }] } }],
    [{ type: "text", text: "There." }],
  ]);
  const s = await startSession({ model, tools, chatEndNote: false });
  const events = await s.sendText("show me");
  await s.close();
  return events;
}

test("the shapes are a small built-in set", () => {
  expect([...MODEL_SHAPES]).toEqual(["sphere", "planet", "torus", "cube", "cell", "molecule", "points", "heightmap"]);
});

test("a ringed planet with a pinned label is drawn as a model card", async () => {
  const events = await drawOne({ kind: "model", id: "p1", title: "black hole", shape: "planet", labels: [{ text: "Singularity", x: 0.2, y: 0.1, z: 0 }] });
  const [beat] = beats(events);
  expect(beat?.marks[0]).toMatchObject({ kind: "model", shape: "planet", labels: [{ text: "Singularity" }] });
  expect(events.find((e) => e.type === "tool.result")).toMatchObject({ status: "ok" });
});

test("a molecule takes atoms and bonds; coordinates are clamped to -1..1", async () => {
  const events = await drawOne({
    kind: "model", id: "p1", title: "water", shape: "molecule",
    atoms: [{ x: 0, y: 0, z: 0, r: 0.4, label: "O" }, { x: 3, y: 0.5, z: 0, label: "H" }, { x: -0.6, y: 0.5, z: 0, label: "H" }],
    bonds: [{ a: 1, b: 2 }, { a: 1, b: 3 }],
  });
  const mark = beats(events)[0]!.marks[0] as { atoms: { x: number }[] };
  expect(mark.atoms[1]!.x).toBe(1);
});

test("bad model cards are a tool error the model hears", async () => {
  for (const [mark, words] of [
    [{ kind: "model", id: "p1", shape: "molecule", atoms: [{ x: 0, y: 0, z: 0 }] }, "at least 2 atoms"],
    [{ kind: "model", id: "p1", shape: "molecule", atoms: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], bonds: [{ a: 1, b: 5 }] }, "bond"],
    [{ kind: "model", id: "p1", shape: "points", points: [{ x: 0, y: 0, z: 0 }] }, "at least 3 points"],
    [{ kind: "model", id: "p1", shape: "heightmap", heights: [0.1, 0.2, 0.3] }, "square"],
    [{ kind: "model", id: "p1", shape: "teapot" }, "shape"],
  ] as const) {
    const events = await drawOne(mark);
    expect(beats(events)).toHaveLength(0);
    const result = events.find((e) => e.type === "tool.result") as { status: string; error: string };
    expect(result.status).toBe("error");
    expect(result.error).toContain(words);
  }
});

test("the prompt says when to use a model card", () => {
  const prompt = systemInstruction("short");
  expect(prompt).toContain("kind model");
  expect(prompt).toMatch(/molecule/);
});
