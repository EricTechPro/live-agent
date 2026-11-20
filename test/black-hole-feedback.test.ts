// Eric's live test (Chinese chat, "black hole"): three near-copy model cards that looked frozen,
// a switch to English after one English word, no picture, and no way to see what Jett was on.
// Seam: the core's event stream (scripted model), the prompt text, and the pure model renderer.
import { expect, test } from "bun:test";
import { addWork, cuesFor, noWork, type Work } from "../app/src/cues.ts";
import { modelSdf, modelTexture, renderModel, type ModelSpec } from "../app/src/model3d.ts";
import { startSession } from "../src/core/agent.ts";
import { bundledTools } from "../src/core/bundled-tools.ts";
import type { AgentEvent, EventOf } from "../src/core/events.ts";
import type { ModelEvent } from "../src/core/model.ts";
import { loadTools } from "../src/core/registry.ts";
import { systemInstruction } from "../src/core/tone.ts";
import { scriptedModel } from "../src/models/scripted.ts";

const tools = await loadTools();
const call = (id: string, name: string, args: Record<string, unknown>): ModelEvent[] => [{ type: "tool.call", id, name, args }];
const say = (text: string): ModelEvent[] => [{ type: "text", text }];
const drawCall = (id: string, ...marks: Record<string, unknown>[]) => call(id, "draw", { beats: marks.map((m, i) => ({ say: `Step ${i + 1} here.`, marks: [m] })) });
const of = <T extends AgentEvent["type"]>(events: AgentEvent[], type: T) => events.filter((e): e is EventOf<T> => e.type === type);

async function turns(script: ModelEvent[][], n: number) {
  const s = await startSession({ model: scriptedModel(script), tools, chatEndNote: false });
  const out: AgentEvent[][] = [];
  for (let i = 0; i < n; i++) out.push(await s.sendText(`turn ${i + 1}`));
  await s.close();
  return out;
}

// ---- 1. one card per idea ------------------------------------------------------

test("a second model card of the same shape updates the first instead of stacking a near-copy", async () => {
  const [a, b] = await turns(
    [
      drawCall("d1", { kind: "model", id: "p1", title: "黑洞", shape: "sphere" }), say("A ball."),
      drawCall("d2", { kind: "model", id: "p2", title: "事件视界", shape: "sphere", labels: [{ text: "事件视界", x: 0.6, y: 0, z: 0 }] }), say("Its edge."),
    ],
    2,
  );
  expect(of(a!, "canvas.beat")[0]!.marks.map((m) => m.id)).toEqual(["p1"]);
  expect(of(b!, "canvas.beat")[0]!.marks).toEqual([]);
  const [edit] = of(b!, "canvas.edit");
  expect(edit!.mark).toMatchObject({ id: "p1", kind: "model", shape: "sphere", title: "事件视界", labels: [{ text: "事件视界" }] });
  const result = of(b!, "tool.result").find((r) => r.id === "d2")!;
  expect(result).toMatchObject({ status: "ok", output: { ids: ["p1"], canvas: ["p1"], updated: [{ from: "p2", into: "p1" }] } });
});

test("a card with the same kind and title updates it too; different cards still add", async () => {
  const [, b] = await turns(
    [
      drawCall("d1", { kind: "list", id: "p1", title: "Parts", items: [{ label: "core" }] }), say("One."),
      drawCall("d2", { kind: "list", id: "p2", title: "parts", items: [{ label: "core" }, { label: "disk" }] }, { kind: "list", id: "p3", title: "Facts", items: [{ label: "dense" }] }),
      say("Two."),
    ],
    2,
  );
  expect(of(b!, "canvas.edit").map((e) => e.mark.id)).toEqual(["p1"]);
  expect(of(b!, "canvas.beat").flatMap((e) => e.marks.map((m) => m.id))).toEqual(["p3"]);
});

test("edit_canvas builds a model up in place: sphere -> planet (the disk), then labels", async () => {
  const [, b] = await turns(
    [
      drawCall("d1", { kind: "model", id: "p1", title: "black hole", shape: "sphere" }), say("A ball."),
      call("e1", "edit_canvas", { edits: [{ id: "p1", shape: "planet", labels: [{ text: "accretion disk", x: 0.8, y: 0, z: 0 }] }] }), say("Now the disk."),
    ],
    2,
  );
  expect(of(b!, "canvas.edit")[0]!.mark).toMatchObject({ id: "p1", shape: "planet", labels: [{ text: "accretion disk" }] });
  expect(of(b!, "tool.result").find((r) => r.id === "e1")).toMatchObject({ status: "ok", output: { edited: ["p1"] } });
});

test("a shape on a card that is not a model is a tool error", async () => {
  const [, b] = await turns(
    [drawCall("d1", { kind: "list", id: "p1", items: [{ label: "a" }] }), say("One."), call("e1", "edit_canvas", { edits: [{ id: "p1", shape: "planet" }] }), say("No.")],
    2,
  );
  expect(of(b!, "tool.result").find((r) => r.id === "e1")).toMatchObject({ status: "error", error: expect.stringContaining("only a model card") });
});

test("the prompt says one card per idea, built up with edit_canvas, and a black hole is one planet card", () => {
  const text = systemInstruction("short");
  expect(text).toContain("One card per idea");
  expect(text).toMatch(/black hole is one planet card/);
  expect(text).toMatch(/edit_canvas the same card/);
});

// ---- 1b. the turn shows ------------------------------------------------------------

test("every round shape visibly changes as it turns (a plain lit sphere looked frozen)", () => {
  const TURN = (15 * Math.PI) / 180;
  for (const shape of ["sphere", "planet", "torus", "cell", "cube"] as const) {
    const spec: ModelSpec = { shape };
    const frame = (t: number) => renderModel(modelSdf(spec), 60, 45, 0.6 + t * TURN, 0.24, modelTexture(spec));
    const a = frame(0), b = frame(1);
    let changed = 0, lit = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i]! > 0) lit++;
      if (Math.abs(a[i]! - b[i]!) > 0.08) changed++;
    }
    // One second of turning moves at least 5% of the dots.
    expect({ shape, moved: changed / lit > 0.05 }).toEqual({ shape, moved: true });
  }
});

// ---- 2. language ------------------------------------------------------------------

test("a borrowed English word in a Chinese sentence is no switch, and shown words follow the language", () => {
  for (const tone of ["short", "casual", "friendly", "pro"] as const) {
    const text = systemInstruction(tone);
    expect(text).toMatch(/latest whole sentence/);
    expect(text).toContain("black hole 是什么？");
    expect(text).toMatch(/Never switch because of one borrowed word/);
    expect(text).toMatch(/card titles, items and labels/);
    expect(text).not.toMatch(/When they switch languages, switch with them/);
  }
});

// ---- 3. a real picture first --------------------------------------------------------

test("real things get a real picture first: the show_image rule comes before draw and the model card", () => {
  const text = systemInstruction("short");
  const picture = text.indexOf("show a real picture first");
  expect(picture).toBeGreaterThan(-1);
  const line = text.split("\n").find((l) => l.includes("show a real picture first"))!;
  expect(line).toMatch(/black hole/);
  expect(line).toMatch(/show_image with mode find, even when they did not ask/);
  expect(picture).toBeLessThan(text.indexOf("call draw"));
  expect(picture).toBeLessThan(text.indexOf("kind model"));
  expect(text).toMatch(/After the picture, at most one model card/);
});

// ---- 4. what Jett is thinking about --------------------------------------------------

test("set_topic is a quiet read tool: its answer never makes the model talk again", async () => {
  const tool = tools.find((t) => t.name === "set_topic")!;
  expect(tool).toMatchObject({ risk: "read", quiet: true });
  expect(bundledTools.some((t) => t.name === "set_topic")).toBe(true);
  const model = scriptedModel([[...call("t1", "set_topic", { topic: "黑洞的结构" }), ...say("黑洞是……")]]);
  const s = await startSession({ model, tools, chatEndNote: false });
  const events = await s.sendText("black hole 是什么？");
  await s.close();
  expect(of(events, "tool.call")[0]).toMatchObject({ name: "set_topic", args: { topic: "黑洞的结构" } });
  expect(of(events, "tool.result")[0]).toMatchObject({ status: "ok", output: { shown: "黑洞的结构" } });
  expect(of(events, "turn.done")).toHaveLength(1);
});

test("the pill shows the topic in the user's language while Jett thinks and talks, until the next question", () => {
  const topic = (lang: "en" | "zh") => addWork(noWork, { type: "tool.call", id: "t1", name: "set_topic", args: { topic: lang === "zh" ? "黑洞的结构" : "black hole structure" } }, lang);
  const zh = topic("zh");
  expect(zh.running).toEqual([]);
  expect(cuesFor({ look: "speaking", topic: zh.topic, caption: { model: "黑洞是……" }, drawing: false }).pill).toEqual({ kind: "think", text: "想：黑洞的结构" });
  expect(cuesFor({ look: "thinking", topic: topic("en").topic, caption: {}, drawing: false }).pill).toEqual({ kind: "think", text: "Thinking: black hole structure" });
  // Its quick result and the turn's end keep it; your next words clear it.
  let w: Work = addWork(zh, { type: "tool.result", id: "t1", name: "set_topic", status: "ok" });
  w = addWork(w, { type: "turn.done", reply: "" });
  expect(w.topic).toBe("想：黑洞的结构");
  expect(addWork(w, { type: "transcript", role: "user", text: "那白洞呢？" }).topic).toBeUndefined();
  // Real work still wins the pill.
  expect(cuesFor({ look: "speaking", working: "Finding a picture…", topic: w.topic, caption: {}, drawing: false }).pill).toEqual({ kind: "work", text: "Finding a picture…" });
});

test("the prompt asks for set_topic in the user's language, never said out loud", () => {
  const text = systemInstruction("short");
  expect(text).toMatch(/call set_topic/);
  expect(text).toMatch(/in the user's language/);
});
