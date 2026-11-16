// Marking real things (slice 4): `mark_screen` through the core's event stream (targets found
// first, `spot` marks on the canvas, pinned and erased when the screen changes), and their
// placement in the drawing layout (app/src/layout.ts): on the element, chips on the side with
// the fewest words, and cards that keep off them.
import { describe, expect, test } from "bun:test";
import { startSession } from "../src/core/agent.ts";
import type { Mark } from "../src/core/canvas.ts";
import type { AgentEvent, EventOf } from "../src/core/events.ts";
import type { AxHit, Eyes, FrontWindow, WatchEvent } from "../src/screen/eyes.ts";
import { scriptedModel } from "../src/models/scripted.ts";
import { chipSpot, layoutScene, layoutSpots, overlaps, type Rect } from "../app/src/layout.ts";
import type { SceneMark } from "../app/src/sketch.ts";
import draw from "../tools/draw.ts";
import editCanvas from "../tools/edit-canvas.ts";
import findOnScreen from "../tools/find-on-screen.ts";
import markScreen from "../tools/mark-screen.ts";

const VIEW = { width: 1440, height: 900 };
const front: FrontWindow = { app: "Google Chrome", pid: 42, windowId: 7, title: "YouTube", bounds: { x: 0, y: 25, w: 1440, h: 875 } };
const subscribe: AxHit = { label: "Subscribe", role: "AXButton", frame: { x: 600, y: 500, w: 96, h: 36 }, exact: true };

function eyesWith(found: AxHit[]) {
  let listener: ((e: WatchEvent) => void) | undefined;
  const eyes: Eyes = {
    permission: async () => true,
    requestPermission: async () => true,
    state: async () => ({ display: { x: 0, y: 0, w: 1440, h: 900 }, front }),
    shot: async () => {
      throw new Error("no shots here");
    },
    watch(on) {
      listener = on;
      return () => (listener = undefined);
    },
    ax: {
      trusted: async () => true,
      request: async () => true,
      find: async (text) => ({ trusted: true, matches: found.filter((f) => f.label?.toLowerCase() === text.toLowerCase()) }),
      controls: async () => ({ trusted: true, controls: found, texts: [] }),
    },
    ocr: async () => ({ lines: [{ text: "182K subscribers", frame: { x: 480, y: 520, w: 100, h: 14 } }], area: front.bounds! }),
  };
  return { eyes, send: (e: WatchEvent) => listener?.(e) };
}

const tools = [draw, editCanvas, findOnScreen, markScreen];
const call = (id: string, name: string, args: Record<string, unknown>) => [{ type: "tool.call" as const, id, name, args }];
const beats = (events: AgentEvent[]) => events.filter((e): e is EventOf<"canvas.beat"> => e.type === "canvas.beat");
const result = (events: AgentEvent[], name: string) => events.find((e): e is EventOf<"tool.result"> => e.type === "tool.result" && e.name === name)!;

describe("mark_screen through the event stream", () => {
  test("'ring the Subscribe button': the core finds it and draws a spot on its real rect, in time with the line", async () => {
    const { eyes } = eyesWith([subscribe]);
    const model = scriptedModel([
      call("m1", "mark_screen", { beats: [{ say: "That's the Subscribe button.", marks: [{ kind: "ring", id: "p1", text: "Subscribe", label: "click here" }] }] }),
      [{ type: "text", text: "That's the Subscribe button." }],
    ]);
    const s = await startSession({ model, tools, eyes, chatEndNote: false });
    const events = await s.sendText("where do I subscribe?");
    const [beat] = beats(events);
    expect(beat!.say).toBe("That's the Subscribe button.");
    expect(beat!.marks[0]).toMatchObject({ kind: "spot", id: "p1", style: "ring", rect: subscribe.frame, label: "click here", via: "ax" });
    // The words beside it come along, for the chip.
    expect((beat!.marks[0] as Extract<Mark, { kind: "spot" }>).texts).toEqual([{ x: 480, y: 520, w: 100, h: 14 }]);
    expect(result(events, "mark_screen").status).toBe("ok");
    expect(events.some((e) => e.type === "canvas.speak")).toBe(true);
    await s.close();
  });

  test("a target that is not on screen: nothing is drawn and the model hears which one", async () => {
    const { eyes } = eyesWith([subscribe]);
    const model = scriptedModel([
      call("m1", "mark_screen", {
        beats: [{ say: "Here and here.", marks: [{ kind: "ring", id: "p1", text: "Subscribe" }, { kind: "arrow", id: "p2", text: "Export" }] }],
      }),
      [{ type: "text", text: "I can't find Export." }],
    ]);
    const s = await startSession({ model, tools, eyes, chatEndNote: false });
    const events = await s.sendText("show me");
    expect(beats(events)).toEqual([]);
    const r = result(events, "mark_screen");
    expect(r.status).toBe("error");
    expect(r.error).toContain("p2");
    expect(r.error).toContain("Export");
    await s.close();
  });

  test("find_on_screen answers a rect, never a guess", async () => {
    const { eyes } = eyesWith([subscribe]);
    const model = scriptedModel([call("f1", "find_on_screen", { text: "Subscribe" }), [{ type: "text", text: "ok" }]]);
    const s = await startSession({ model, tools, eyes, chatEndNote: false });
    const r = result(await s.sendText("find it"), "find_on_screen");
    expect(r.output).toMatchObject({ found: true, via: "ax", rect: subscribe.frame });
    await s.close();
  });

  test("scrolling the window erases the marks (screen.stale, then canvas.erase); erase p1 works like any mark", async () => {
    const { eyes, send } = eyesWith([subscribe, { ...subscribe, label: "Share", frame: { x: 800, y: 500, w: 60, h: 36 } }]);
    const model = scriptedModel([
      call("m1", "mark_screen", { beats: [{ say: "These two.", marks: [{ kind: "ring", id: "p1", text: "Subscribe" }, { kind: "underline", id: "p2", text: "Share" }] }] }),
      [{ type: "text", text: "These two." }],
      call("e1", "edit_canvas", { erase: ["p1"] }),
      [{ type: "text", text: "Gone." }],
    ]);
    const s = await startSession({ model, tools, eyes, chatEndNote: false });
    await s.sendText("show me");
    const erase = await s.sendText("erase the ring");
    expect(erase.find((e) => e.type === "canvas.erase")).toMatchObject({ ids: ["p1"] });
    const seen: AgentEvent[] = [];
    s.onEvent((e) => seen.push(e));
    send({ type: "front", front });
    expect(seen.some((e) => e.type === "screen.stale")).toBe(false);
    send({ type: "scroll", at: { x: 700, y: 400 } });
    expect(seen.filter((e) => e.type === "screen.stale" || e.type === "canvas.erase")).toEqual([
      { type: "screen.stale", ids: ["p2"], reason: "scrolled" },
      { type: "canvas.erase", id: "screen-stale", ids: ["p2"], all: false },
    ]);
    await s.close();
  });

  test("draw refuses spot marks: only mark_screen puts things on the real screen", async () => {
    const model = scriptedModel([
      call("d1", "draw", { beats: [{ say: "x", marks: [{ kind: "spot", id: "p1", style: "ring", rect: { x: 1, y: 1, w: 9, h: 9 } }] }] }),
      [{ type: "text", text: "ok" }],
    ]);
    const s = await startSession({ model, tools, chatEndNote: false });
    expect(result(await s.sendText("x"), "draw").error).toContain("mark_screen");
    await s.close();
  });
});

const spotMark = (id: string, style: string, rect: Rect, label?: string, texts: Rect[] = []): SceneMark => ({
  mark: { kind: "spot", id, style, rect, label, texts } as Mark,
  say: "line",
  beatKey: "m1:0",
});
const area = (a: Rect, b: Rect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

describe("placing screen marks", () => {
  test("a ring goes round the real element, in window px (global points minus the window's origin)", () => {
    const out = layoutScene({ marks: [spotMark("p1", "ring", { x: 600, y: 525, w: 96, h: 36 })], view: VIEW, origin: { x: 0, y: 25 } });
    const pts = out.screen.flatMap((o) => (o.prim.t === "stroke" ? o.prim.pts : []));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    expect(Math.min(...xs)).toBeLessThan(600);
    expect(Math.max(...xs)).toBeGreaterThan(696);
    expect(Math.min(...ys)).toBeLessThan(500);
    expect(Math.max(...ys)).toBeGreaterThan(536);
    // ... and close round it, not across the screen.
    expect(Math.min(...ys)).toBeGreaterThan(480);
    expect(out.cards).toEqual([]);
  });

  test("the chip takes the side that covers the least text", () => {
    const el = { x: 600, y: 400, w: 96, h: 36 };
    // Words above and to the right; nothing below.
    const texts = [{ x: 560, y: 360, w: 200, h: 16 }, { x: 710, y: 405, w: 200, h: 16 }];
    const at = chipSpot(el, 90, 22, texts, [], VIEW);
    expect(at.y).toBeGreaterThan(el.y + el.h);
    expect(texts.every((t) => area(at, t) === 0)).toBe(true);
    // Words below too: then the left, which is clear.
    const more = [...texts, { x: 560, y: 440, w: 200, h: 16 }];
    const left = chipSpot(el, 90, 22, more, [], VIEW);
    expect(left.x + left.w).toBeLessThanOrEqual(el.x);
  });

  test("a chip never leaves the screen: at the top edge it goes below", () => {
    const at = chipSpot({ x: 600, y: 4, w: 96, h: 30 }, 90, 22, [], [], VIEW);
    expect(at.y).toBeGreaterThan(30);
  });

  test("labels of two marks never sit on each other or on the other mark", () => {
    const { prims } = layoutSpots(
      [
        { id: "p1", style: "ring", rect: { x: 600, y: 400, w: 96, h: 36 }, label: "click here" },
        { id: "p2", style: "ring", rect: { x: 600, y: 340, w: 96, h: 36 }, label: "or here" },
      ],
      VIEW,
    );
    const chips = prims.flatMap((o) => (o.prim.t === "text" ? [o.prim.box] : []));
    expect(chips.length).toBe(2);
    expect(overlaps(chips[0]!, chips[1]!)).toBe(false);
    for (const c of chips) for (const el of [{ x: 600, y: 400, w: 96, h: 36 }, { x: 600, y: 340, w: 96, h: 36 }]) expect(area(c, el)).toBe(0);
  });

  test("every style draws ink owned by its id; an arrow ends at the element", () => {
    const rect = { x: 700, y: 300, w: 80, h: 30 };
    for (const style of ["ring", "arrow", "underline", "highlight", "label"]) {
      const out = layoutScene({ marks: [spotMark("p1", style, rect, style === "label" ? "Scale" : undefined)], view: VIEW });
      expect(out.screen.length).toBeGreaterThan(0);
      expect(out.screen.every((o) => o.owner === "p1")).toBe(true);
    }
    const arrow = layoutScene({ marks: [spotMark("p1", "arrow", rect)], view: VIEW }).screen[0]!.prim as { pts: { x: number; y: number }[] };
    const tip = arrow.pts.at(-1)!;
    expect(Math.min(Math.abs(tip.x - rect.x), Math.abs(tip.x - (rect.x + rect.w)), Math.abs(tip.y - rect.y), Math.abs(tip.y - (rect.y + rect.h)))).toBeLessThan(14);
  });

  test("a card drawn in the same answer does not cover the ringed element or its chip", () => {
    const rect = { x: 40, y: 60, w: 120, h: 40 };
    const card: SceneMark = {
      mark: { kind: "list", id: "p2", title: "steps", items: [{ label: "one" }, { label: "two" }, { label: "three" }] } as Mark,
      say: "line",
      beatKey: "d1:0",
    };
    const out = layoutScene({ marks: [spotMark("p1", "ring", rect, "Export"), card], view: VIEW, from: "left" });
    const ink = out.screen.flatMap((o) => (o.prim.t === "text" ? [o.prim.box] : o.prim.t === "stroke" ? [boxOf(o.prim.pts)] : []));
    expect(out.cards.length).toBe(1);
    for (const r of [rect, ...ink]) expect(overlaps(out.cards[0]!.rect, r)).toBe(false);
  });
});

function boxOf(pts: { x: number; y: number }[]): Rect {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
