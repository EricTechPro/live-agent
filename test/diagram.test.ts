// The diagram tool (ticket 16), through the agent core's event stream.
// "Draw how this works": the model hands Mermaid source to `draw_diagram`, the
// core puts a `diagram` event on the stream, and the window draws it.
import { expect, test } from "bun:test";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent } from "../src/core/events.ts";
import { scriptedModel } from "../src/models/scripted.ts";
import { addDiagramEvent, noDiagram } from "../app/src/diagram.ts";

const source = "flowchart LR\n  mic --> core --> voice";

test("'draw how this works' calls draw_diagram, a read tool, and the diagram lands on the stream", async () => {
  const model = scriptedModel([
    [
      { type: "text", text: "Here is how it flows." },
      { type: "tool.call", id: "d1", name: "draw_diagram", args: { title: "How it works", source } },
    ],
    [{ type: "text", text: "It's on screen." }],
  ]);
  const session = await startSession({ model });

  const events = await session.sendText("Draw how this works");

  expect(events).toContainEqual({
    type: "tool.call", id: "d1", name: "draw_diagram", args: { title: "How it works", source }, risk: "read",
  });
  expect(events).toContainEqual(expect.objectContaining({ type: "safety.verdict", id: "d1", verdict: "allow" }));
  expect(events).toContainEqual({ type: "diagram", id: "d1", title: "How it works", source });
  expect(events).toContainEqual(expect.objectContaining({ type: "tool.result", id: "d1", status: "ok" }));
  // The voice kept going: its words came before the diagram, and the turn still ends normally.
  const at = (t: string) => events.findIndex((e) => e.type === t);
  expect(at("transcript")).toBeLessThan(at("diagram"));
  expect(events.at(-1)?.type).toBe("turn.done");
  await session.close();
});

test("empty diagram source is an error the model hears, and nothing reaches the window", async () => {
  const model = scriptedModel([
    [{ type: "tool.call", id: "d1", name: "draw_diagram", args: { source: "  " } }],
    [{ type: "text", text: "Sorry." }],
  ]);
  const session = await startSession({ model });

  const events = await session.sendText("Draw it");

  expect(events.some((e) => e.type === "diagram")).toBe(false);
  expect(events).toContainEqual(expect.objectContaining({ type: "tool.result", id: "d1", status: "error" }));
  await session.close();
});

const panel = (events: AgentEvent[]) => events.reduce(addDiagramEvent, noDiagram);

test("the window's panel shows the latest diagram and clears on a new chat", () => {
  const first: AgentEvent = { type: "diagram", id: "d1", source: "flowchart LR\n a-->b" };
  const second: AgentEvent = { type: "diagram", id: "d2", title: "Two", source: "flowchart LR\n c-->d" };
  expect(panel([first, second, { type: "turn.done", reply: "" }])).toEqual({ id: "d2", title: "Two", source: "flowchart LR\n c-->d" });
  expect(panel([first, { type: "chat.started" }])).toBe(noDiagram);
});
