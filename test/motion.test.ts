// Drawing v2 motion (app/src/motion.ts): how one card or ink mark draws.
import { expect, test } from "bun:test";
import type { Prim } from "../app/src/layout.ts";
import { HAND, handDrawn, MOTION, stepAt, strokeMs, textMs, typed, unitPlan } from "../app/src/motion.ts";

const id = (p: { x: number; y: number }) => p;
const line = (len: number): Prim => ({ t: "stroke", pts: [{ x: 0, y: 0 }, { x: len, y: 0 }], width: 4, tone: "ink" });
const words = (text: string): Prim => ({ t: "text", box: { x: 0, y: 40, w: text.length * 8, h: 18 }, lines: [text], size: 13, weight: 400, align: "left", tone: "text" });

test("strokes go at about 900 px/s and take 0.25 to 1 s each", () => {
  expect(strokeMs(450)).toBe(500);
  expect(strokeMs(10)).toBe(250);
  expect(strokeMs(5000)).toBe(1000);
});

test("a card drags open (0.45 s), then its title types, then its contents draw, the pen flying between", () => {
  const plan = unitPlan([line(450), words("Star")], id, { rect: { x: 10, y: 10, w: 300, h: 160 } });
  const kinds = plan.steps.map((s) => s.kind);
  expect(kinds).toEqual(["open", "fly", "title", "fly", "prim", "fly", "prim"]);
  expect(plan.steps[0]!.ms).toBe(MOTION.openMs);
  // The pen rides the opening card's bottom-right corner.
  expect(plan.steps[0]!.to).toEqual({ x: 310, y: 170 });
});

test("stepAt walks the steps; a squeezed slot runs every step faster", () => {
  const plan = unitPlan([line(450), words("Collapse")], id);
  const natural = stepAt(plan, { start: 0, end: plan.total }, 250);
  expect(natural.index).toBe(0);
  expect(natural.t).toBeCloseTo(0.5, 2);
  const fast = stepAt(plan, { start: 0, end: plan.total / 2 }, 125);
  expect(fast.t).toBeCloseTo(0.5, 2);
  expect(stepAt(plan, { start: 0, end: 100 }, 500).index).toBe(plan.steps.length);
});

test("words type one character at a time; the last two stay hot until they settle", () => {
  expect(textMs(10)).toBe(10 * MOTION.charMs);
  const half = typed(["Black hole", "Light can't escape"], 0.5);
  expect(half.lines.join("").length).toBe(14);
  expect(half.hot).toBe(2);
  expect(typed(["Star"], 1)).toEqual({ lines: ["Star"], hot: 0 });
  expect(typed(["Star"], 0)).toEqual({ lines: [], hot: 0 });
});

test("strokes look hand drawn: a line bows and wobbles a little, the same way every redraw", () => {
  const line = [{ x: 0, y: 0 }, { x: 300, y: 0 }];
  const a = handDrawn(line, "p3:0");
  expect(a.length).toBeGreaterThan(20);
  expect(handDrawn(line, "p3:0")).toEqual(a);
  expect(handDrawn(line, "p4:0")).not.toEqual(a);
  const off = a.map((p) => Math.abs(p.y));
  expect(Math.max(...off)).toBeGreaterThan(0.3);
  expect(Math.max(...off)).toBeLessThan(HAND.maxBow + HAND.wobble * 2 + HAND.jitter);
  expect(a[0]!.x).toBeCloseTo(0, -1);
  expect(a.at(-1)!.x).toBeCloseTo(300, -1);
});

test("a closed loop keeps its ends together, and a tick barely moves", () => {
  const loop = Array.from({ length: 65 }, (_, i) => ({ x: 100 + 80 * Math.cos((i / 64) * Math.PI * 2), y: 100 + 40 * Math.sin((i / 64) * Math.PI * 2) }));
  const h = handDrawn(loop, "p9:0");
  expect(Math.hypot(h[0]!.x - h.at(-1)!.x, h[0]!.y - h.at(-1)!.y)).toBeLessThan(0.5);
  const tick = handDrawn([{ x: 0, y: 0 }, { x: 6, y: 6 }, { x: 16, y: -8 }], "p2:1");
  const d = Math.max(...tick.map((p, i) => (i ? 0 : Math.hypot(p.x, p.y))));
  expect(d).toBeLessThan(1);
});
