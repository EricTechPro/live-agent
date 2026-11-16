// Drawing v2 motion (app/src/motion.ts): how one card or ink mark draws.
import { expect, test } from "bun:test";
import type { Prim } from "../app/src/layout.ts";
import { MOTION, stepAt, strokeMs, textMs, typed, unitPlan } from "../app/src/motion.ts";

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
