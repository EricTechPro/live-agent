// Ticket 31: the `draw` tool, through the agent core's event stream.
// The model sends beats (one spoken line + the marks drawn while it is said);
// the core checks every mark with Zod and emits one `canvas.beat` per beat.
// Bad marks are a tool error the model hears, and nothing reaches the window.
import { expect, test } from "bun:test";
import { startSession } from "../src/core/agent.ts";
import { BOARD } from "../src/core/canvas.ts";
import type { AgentEvent, EventOf } from "../src/core/events.ts";
import type { ModelEvent } from "../src/core/model.ts";
import { bundledTools } from "../src/core/bundled-tools.ts";
import { loadTools } from "../src/core/registry.ts";
import { systemInstruction } from "../src/core/tone.ts";
import { scriptedModel } from "../src/models/scripted.ts";

const tools = await loadTools();
const draw = (id: string, beats: unknown): ModelEvent => ({ type: "tool.call", id, name: "draw", args: { beats } });
const say = (text: string): ModelEvent[] => [{ type: "text", text }];
const beats = (events: AgentEvent[]) => events.filter((e): e is EventOf<"canvas.beat"> => e.type === "canvas.beat");
const canvasEvents = (events: AgentEvent[]) => events.filter((e) => e.type.startsWith("canvas."));

const good = [
  {
    say: "The mic sends your voice to the core.",
    marks: [
      { kind: "box", id: "p1", x: 40, y: 200, w: 200, h: 100, label: "Mic" },
      { kind: "box", id: "p2", x: 400, y: 200, w: 200, h: 100, label: "Core" },
      { kind: "arrow", id: "p3", from: { x: 240, y: 250 }, to: { x: 400, y: 250 } },
    ],
  },
  {
    say: "Then it answers out loud.",
    marks: [
      { kind: "text", id: "p4", x: 700, y: 250, text: "Voice" },
      { kind: "line", id: "p5", from: { x: 600, y: 250 }, to: { x: 690, y: 250 }, color: "blue" },
      { kind: "circle", id: "p6", x: 500, y: 250, r: 120, color: "red" },
      { kind: "underline", id: "p7", x: 700, y: 270, w: 80 },
      { kind: "check", id: "p8", x: 900, y: 100 },
      { kind: "cross", id: "p9", x: 900, y: 500, size: 40 },
      { kind: "step", id: "p10", x: 60, y: 60, n: 1, label: "Speak" },
    ],
  },
];

async function oneCall(beatsArg: unknown, mode: "ask-me" | "bypass" = "ask-me") {
  const s = await startSession({ model: scriptedModel([[draw("d1", beatsArg)], say("There.")]), tools, mode, chatEndNote: false });
  const events = await s.sendText("Draw how it works");
  await s.close();
  return events;
}

test("draw is a read tool in tools/ and in the bundled list, with a flat JSON schema", () => {
  const tool = tools.find((t) => t.name === "draw")!;
  expect(tool.risk).toBe("read");
  expect(bundledTools.some((t) => t.name === "draw")).toBe(true);
  const schema = JSON.stringify(tool.parameters);
  // Gemini Live takes a plain OpenAPI subset: no anyOf / oneOf / const.
  expect(schema).not.toMatch(/anyOf|oneOf|allOf|"const"|\$ref/);
  expect(tool.parameters).toMatchObject({ type: "object", required: ["beats"] });
  // draw_diagram is retired (ticket 35): diagrams are draw marks now.
  expect(tools.some((t) => t.name === "draw_diagram")).toBe(false);
});

test("a good call emits canvas.beat events in order, after the tool call and the allow verdict", async () => {
  const events = await oneCall(good); // even in Ask me: read tools are allowed
  const at = (match: (e: AgentEvent) => boolean) => events.findIndex(match);
  const call = at((e) => e.type === "tool.call" && e.id === "d1");
  const allow = at((e) => e.type === "safety.verdict" && e.id === "d1" && e.verdict === "allow");
  const out = beats(events);
  expect(out.map((b) => [b.id, b.beat, b.say])).toEqual([
    ["d1", 0, good[0]!.say],
    ["d1", 1, good[1]!.say],
  ]);
  expect(out[0]!.marks).toEqual(good[0]!.marks as never);
  expect(out[1]!.marks.map((m) => m.kind)).toEqual(["text", "line", "circle", "underline", "check", "cross", "step"]);
  expect(call).toBeLessThan(allow);
  expect(allow).toBeLessThan(events.indexOf(out[0]!));
  expect(events).toContainEqual(expect.objectContaining({ type: "tool.result", id: "d1", status: "ok", output: { drawn: 10, ids: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10"], canvas: ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10"] } }));
  expect(events.at(-1)?.type).toBe("turn.done");
});

const bad: [string, unknown, string][] = [
  ["unknown kind", [{ say: "x", marks: [{ kind: "star", id: "p1", x: 1, y: 1 }] }], "kind"],
  ["missing id", [{ say: "x", marks: [{ kind: "check", x: 10, y: 10 }] }], "id"],
  ["bad id", [{ say: "x", marks: [{ kind: "check", id: "box1", x: 10, y: 10 }] }], "p1"],
  [
    "duplicate id",
    [{ say: "a", marks: [{ kind: "check", id: "p1", x: 10, y: 10 }] }, { say: "b", marks: [{ kind: "cross", id: "p1", x: 20, y: 20 }] }],
    "p1 is used twice",
  ],
  ["off the board", [{ say: "x", marks: [{ kind: "box", id: "p1", x: 900, y: 10, w: 200, h: 50 }] }], "off the board"],
  ["negative coordinate", [{ say: "x", marks: [{ kind: "text", id: "p1", x: -5, y: 10, text: "hi" }] }], "x"],
  ["ring off the board", [{ say: "x", marks: [{ kind: "circle", id: "p1", x: 20, y: 300, r: 50 }] }], "off the board"],
  ["no beats", [], "beat"],
  ["empty say", [{ say: " ", marks: [{ kind: "check", id: "p1", x: 10, y: 10 }] }], "say"],
];

for (const [name, args, hint] of bad) {
  test(`a bad call (${name}) is an error the model hears, and no canvas event is emitted`, async () => {
    const events = await oneCall(args);
    expect(canvasEvents(events)).toEqual([]);
    const result = events.find((e): e is EventOf<"tool.result"> => e.type === "tool.result" && e.id === "d1")!;
    expect(result.status).toBe("error");
    expect(result.error).toContain(hint);
  });
}

test("ids stay unique on the canvas across calls; a new chat starts a clean board", async () => {
  const mark = { kind: "check", id: "p1", x: 10, y: 10 };
  const s = await startSession({
    model: scriptedModel([[draw("d1", [{ say: "one", marks: [mark] }])], say("ok"), [draw("d2", [{ say: "again", marks: [mark] }])], say("no"), [draw("d3", [{ say: "fresh", marks: [mark] }])], say("ok")]),
    tools, mode: "bypass", chatEndNote: false,
  });
  const first = await s.sendText("draw");
  expect(beats(first)).toHaveLength(1);
  const second = await s.sendText("draw again");
  expect(canvasEvents(second)).toEqual([]);
  expect(second).toContainEqual(expect.objectContaining({ type: "tool.result", id: "d2", status: "error", error: expect.stringContaining("p1 is already on the canvas") }));
  await s.newChat();
  const third = await s.sendText("draw fresh");
  expect(beats(third)).toHaveLength(1);
  await s.close();
});

test("the board is a fixed 1000 x 600, and the system prompt says when to draw and to keep beats small", () => {
  expect(BOARD).toEqual({ width: 1000, height: 600 });
  const prompt = systemInstruction("short", { brainPath: "/brain" });
  expect(prompt).toContain("call draw");
  expect(prompt).toContain("a few marks per beat");
});
