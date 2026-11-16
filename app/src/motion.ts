// Drawing v2 motion: how one mark (a card, or ink) draws, step by step. Pure.
//
//   const plan = unitPlan(prims, toScreenPt, card?)  // steps with natural times
//   pen.ts spreads the marks of a beat over its line; the view then asks
//   stepAt(plan, slot, now)                          // which step, how far, where the pen is
//
// A card drags open from its top-left corner (0.45 s), its title types in (0.4 s),
// then its contents draw in order. Strokes go at about 900 px/s, 0.25 to 1 s each.
// Words type one character at a time. Between two steps the pen flies.
// Idea from Roamies (AGPL): idea only, our own code.
import type { Prim, Rect } from "./layout.ts";
import { pathLength, type Pt } from "./sketch.ts";

export const MOTION = {
  openMs: 450,
  titleMs: 400,
  /** px per second. */
  penSpeed: 900,
  strokeMinMs: 250,
  strokeMaxMs: 1000,
  charMs: 28,
  textMinMs: 160,
  textMaxMs: 1100,
  dotMs: 140,
  /** Flight: px per second, and its bounds. */
  flySpeed: 2400,
  flyMinMs: 70,
  flyMaxMs: 260,
  /** Typed characters stay this bright until this many more have landed. */
  hotChars: 2,
} as const;

export type Step =
  | { kind: "open"; ms: number; from: Pt; to: Pt }
  | { kind: "title"; ms: number; from: Pt; to: Pt }
  | { kind: "prim"; prim: Prim; ms: number; from: Pt; to: Pt }
  | { kind: "fly"; ms: number; from: Pt; to: Pt };

export interface UnitPlan {
  steps: Step[];
  /** Natural time, ms. */
  total: number;
  start: Pt;
  end: Pt;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function strokeMs(lengthPx: number) {
  return clamp((lengthPx / MOTION.penSpeed) * 1000, MOTION.strokeMinMs, MOTION.strokeMaxMs);
}
export function textMs(chars: number) {
  return clamp(chars * MOTION.charMs, MOTION.textMinMs, MOTION.textMaxMs);
}

/** Where the pen starts and ends a primitive, mapped to screen px. */
function ends(prim: Prim, map: (p: Pt) => Pt): [Pt, Pt] {
  if (prim.t === "stroke") return [map(prim.pts[0]!), map(prim.pts.at(-1)!)];
  if (prim.t === "dot") return [map(prim), map(prim)];
  const b = prim.box;
  const last = prim.lines.at(-1) ?? "";
  const lineH = prim.size * 1.38;
  const right = b.x + (prim.align === "left" ? (last.length / Math.max(1, Math.max(...prim.lines.map((l) => l.length)))) * b.w : b.w);
  return [map({ x: b.x, y: b.y + lineH * 0.8 }), map({ x: right, y: b.y + b.h - lineH * 0.2 })];
}

function primMs(prim: Prim, map: (p: Pt) => Pt): number {
  if (prim.t === "dot") return MOTION.dotMs;
  if (prim.t === "text") return textMs(prim.lines.join("").length);
  return strokeMs(pathLength(prim.pts.map(map)));
}

const fly = (from: Pt, to: Pt): Step => ({
  kind: "fly", from, to,
  ms: clamp((Math.hypot(to.x - from.x, to.y - from.y) / MOTION.flySpeed) * 1000, MOTION.flyMinMs, MOTION.flyMaxMs),
});

/**
 * The steps of one mark. `map` takes the prims' coordinates to screen px.
 * With `card` (its screen rect): open, then the title, then the prims.
 */
export function unitPlan(prims: Prim[], map: (p: Pt) => Pt, card?: { rect: Rect }): UnitPlan {
  const steps: Step[] = [];
  let at: Pt | undefined;
  if (card) {
    const r = card.rect;
    const tl = { x: r.x, y: r.y };
    const br = { x: r.x + r.w, y: r.y + r.h };
    steps.push({ kind: "open", ms: MOTION.openMs, from: tl, to: br });
    const tStart = { x: r.x + r.w / 2 - 30, y: r.y + 13 };
    steps.push(fly(br, tStart));
    steps.push({ kind: "title", ms: MOTION.titleMs, from: tStart, to: { x: r.x + r.w / 2 + 30, y: r.y + 13 } });
    at = steps.at(-1)!.to;
  }
  for (const prim of prims) {
    const [a, b] = ends(prim, map);
    if (at) steps.push(fly(at, a));
    steps.push({ kind: "prim", prim, ms: primMs(prim, map), from: a, to: b });
    at = b;
  }
  const total = steps.reduce((sum, s) => sum + s.ms, 0);
  const start = steps[0]?.from ?? { x: 0, y: 0 };
  return { steps, total, start, end: at ?? start };
}

export interface StepState {
  /** Steps fully done before this one. */
  index: number;
  /** Progress of step `index`, 0 to 1 (1 and index = steps.length when the unit is done). */
  t: number;
  pen: Pt;
}

/** The step under way at `now`, when the unit's natural time is squeezed or stretched into `slot`. */
export function stepAt(plan: UnitPlan, slot: { start: number; end: number }, now: number): StepState {
  if (now >= slot.end || plan.total <= 0) return { index: plan.steps.length, t: 1, pen: plan.end };
  if (now <= slot.start) return { index: 0, t: 0, pen: plan.start };
  const k = (slot.end - slot.start) / plan.total;
  let left = now - slot.start;
  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i]!;
    const ms = s.ms * k;
    if (left < ms) {
      const t = ms > 0 ? left / ms : 1;
      return { index: i, t, pen: penOn(s, t) };
    }
    left -= ms;
  }
  return { index: plan.steps.length, t: 1, pen: plan.end };
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeInOut = ease;

function penOn(s: Step, t: number): Pt {
  const e = s.kind === "fly" || s.kind === "open" ? ease(t) : t;
  return { x: s.from.x + (s.to.x - s.from.x) * e, y: s.from.y + (s.to.y - s.from.y) * e };
}

/** How much of some lines shows at progress t: whole lines, a cut line, and how many trailing characters are still hot. */
export function typed(lines: string[], t: number): { lines: string[]; hot: number } {
  const total = lines.reduce((n, l) => n + l.length, 0);
  if (t >= 1) return { lines, hot: 0 };
  let left = Math.floor(total * Math.max(0, t));
  const out: string[] = [];
  for (const l of lines) {
    if (left <= 0) break;
    out.push(l.slice(0, left));
    left -= l.length;
  }
  return { lines: out, hot: Math.min(MOTION.hotChars, Math.floor(total * Math.max(0, t))) };
}
