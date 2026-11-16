// The sketch canvas's pure parts (tickets 32 to 35). Pure, like panel.ts and transcript.ts:
//
//   scene = addCanvasEvent(scene, event)   // marks by id, from `canvas.beat`; a new chat clears it
//   const ink = inkFor(mark)               // the pen strokes and written words of one mark
//   const plan = planMarks({ ... })        // when each new mark's pen starts and stops
//   fitBoard(w, h)                         // the 1000 x 600 board scaled into the panel
//
// The look: hand-drawn strokes that wobble a little. The wobble comes from a
// random stream seeded by the mark's id, so the same mark always draws the same
// way and a redraw (resize, Retina) never jitters. sketch-view.ts paints it.
// Idea from Roamies (AGPL): idea only, our own code.
import type { COLORS, Mark } from "../../src/core/canvas.ts";
import type { AgentEvent } from "../../src/core/events.ts";

/** The core's virtual board (src/core/canvas.ts), copied so the window never bundles Zod. A test keeps them equal. */
export const BOARD = { width: 1000, height: 600 } as const;

export interface Pt {
  x: number;
  y: number;
}

// ---- scene: the marks on the canvas, by id -------------------------------------

export interface SceneMark {
  mark: Mark;
  /** The line Jett says while this mark draws (its beat's `say`). */
  say: string;
  /** Which beat brought it: `<tool call id>:<beat index>`. */
  beatKey: string;
}

export interface Scene {
  marks: SceneMark[];
}

export const emptyScene: Scene = { marks: [] };

/**
 * A beat adds its marks after the ones already drawn; a known id is replaced in place.
 * An edit swaps in the changed mark (same place, beat and line); an erase removes ids.
 * `chat.started` clears.
 */
export function addCanvasEvent(scene: Scene, event: AgentEvent): Scene {
  if (event.type === "chat.started") return emptyScene;
  if (event.type === "canvas.edit") {
    const at = scene.marks.findIndex((m) => m.mark.id === event.mark.id);
    if (at < 0) return scene;
    const marks = [...scene.marks];
    marks[at] = { ...marks[at]!, mark: event.mark };
    return { marks };
  }
  if (event.type === "canvas.erase") {
    if (event.all) return emptyScene;
    const gone = new Set(event.ids);
    return { marks: scene.marks.filter((m) => !gone.has(m.mark.id)) };
  }
  if (event.type !== "canvas.beat") return scene;
  const beatKey = `${event.id}:${event.beat}`;
  const marks = [...scene.marks];
  for (const mark of event.marks) {
    const next = { mark, say: event.say, beatKey };
    const at = marks.findIndex((m) => m.mark.id === mark.id);
    if (at >= 0) marks[at] = next;
    else marks.push(next);
  }
  return { marks };
}

// ---- diagram cards (ticket 35) ---------------------------------------------------

export type DiagramMark = Extract<Mark, { kind: "diagram" }>;

/** The diagram cards on the canvas, in drawing order. */
export function diagramCards(scene: Scene): DiagramMark[] {
  return scene.marks.flatMap(({ mark }) => (mark.kind === "diagram" ? [mark] : []));
}

// ---- resolved ink marks ------------------------------------------------------------

/**
 * A free-ink mark with every number filled in (layout.ts resolves the model's hints
 * or card targets into these). Coordinates are in whatever space the caller draws in.
 */
export type InkMark =
  | { kind: "box"; id: string; x: number; y: number; w: number; h: number; label?: string; color?: Color }
  | { kind: "text"; id: string; x: number; y: number; text: string; size?: number; color?: Color }
  | { kind: "arrow"; id: string; from: Pt; to: Pt; label?: string; color?: Color }
  | { kind: "line"; id: string; from: Pt; to: Pt; color?: Color }
  | { kind: "circle"; id: string; x: number; y: number; r: number; ry?: number; color?: Color }
  | { kind: "underline"; id: string; x: number; y: number; w: number; color?: Color }
  | { kind: "check"; id: string; x: number; y: number; size?: number; color?: Color }
  | { kind: "cross"; id: string; x: number; y: number; size?: number; color?: Color }
  | { kind: "step"; id: string; x: number; y: number; n: number; label?: string; color?: Color };
type Color = (typeof COLORS)[number];

// ---- fitting the board into the panel ------------------------------------------

/** Scale the board to fit `width` x `height` (CSS pixels), keep its shape, centre it. */
export function fitBoard(width: number, height: number) {
  const scale = Math.max(0, Math.min(width / BOARD.width, height / BOARD.height));
  const w = BOARD.width * scale;
  const h = BOARD.height * scale;
  return { scale, width: w, height: h, x: (width - w) / 2, y: (height - h) / 2 };
}

// ---- colours -----------------------------------------------------------------

/** Pen colours, light enough to glow on the dark teal background. Ink is the teal pen (drawing v2). */
export const INK_COLORS: Record<(typeof COLORS)[number], string> = {
  ink: "#78ffe2",
  red: "#ff8a7a",
  blue: "#7cc8ff",
  green: "#8dfba4",
  orange: "#ffc06a",
  purple: "#cfa6ff",
};

// ---- seeded wobble ---------------------------------------------------------------

/** A small random stream in [0, 1), the same for the same seed (FNV-1a hash into mulberry32). */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rand = () => number;
const jitter = (rand: Rand, amount: number) => (rand() - 0.5) * 2 * amount;

/** A hand-drawn line from a to b: a gentle bow plus a small slow waver, ends nudged a little. */
export function roughLine(a: Pt, b: Pt, rand: Rand, waver = 1): Pt[] {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const n = Math.max(8, Math.ceil(len / 10));
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const bow = jitter(rand, Math.min(len * 0.025, 5));
  const amp = 0.7 * waver;
  const freq = 1 + rand() * 1.5;
  const phase = rand() * Math.PI * 2;
  const start = { x: a.x + jitter(rand, 1.5), y: a.y + jitter(rand, 1.5) };
  const end = { x: b.x + jitter(rand, 1.5), y: b.y + jitter(rand, 1.5) };
  const points: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const off = bow * Math.sin(Math.PI * t) + amp * Math.sin(2 * Math.PI * freq * t + phase);
    points.push({
      x: start.x + (end.x - start.x) * t - uy * off,
      y: start.y + (end.y - start.y) * t + ux * off,
    });
  }
  return points;
}

/** A ring: a bit more than a full turn, radius drifting slightly, so it overlaps where it started. `ry` makes it an oval. */
export function roughRing(c: Pt, r: number, rand: Rand, ry = r): Pt[] {
  const from = rand() * Math.PI * 2;
  const sweep = Math.PI * 2 + 0.35 + rand() * 0.3;
  const n = Math.max(28, Math.ceil((r * sweep) / 7));
  const drift = 0.05 + rand() * 0.03;
  const squash = 1 + jitter(rand, 0.04);
  const phase = rand() * Math.PI * 2;
  const points: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = from + sweep * t;
    const rr = r * (1 + drift * (t - 0.5) + 0.015 * Math.sin(3 * a + phase));
    points.push({ x: c.x + Math.cos(a) * rr * squash, y: c.y + (Math.sin(a) * rr * (ry / r)) / squash });
  }
  return points;
}

// ---- marks into ink -----------------------------------------------------------------

export type Part =
  | { kind: "stroke"; points: Pt[]; length: number; width: number }
  | { kind: "text"; x: number; y: number; text: string; size: number; align: "left" | "center"; length: number };

export interface Ink {
  color: string;
  parts: Part[];
  /** Pen travel for the whole mark, in board units (text counts as its rough width). */
  length: number;
}

const PEN = 3.4;

export function pathLength(points: Pt[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return total;
}

const stroke = (points: Pt[], width = PEN): Part => ({ kind: "stroke", points, length: pathLength(points), width });
const write = (x: number, y: number, text: string, size: number, align: "left" | "center" = "center"): Part => ({
  kind: "text", x, y, text, size, align, length: text.length * size * 0.6,
});

/** Grow a segment past both ends a little, like a quick pen overshooting a corner. */
function overshoot(a: Pt, b: Pt, by: number): [Pt, Pt] {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const dx = ((b.x - a.x) / len) * by;
  const dy = ((b.y - a.y) / len) * by;
  return [{ x: a.x - dx, y: a.y - dy }, { x: b.x + dx, y: b.y + dy }];
}

/** The strokes and words for one mark, in drawing order. Deterministic per mark id. */
export function inkFor(mark: InkMark): Ink {
  const rand = seededRandom(mark.id);
  const parts: Part[] = [];
  switch (mark.kind) {
    case "box": {
      const { x, y, w, h } = mark;
      const corners: Pt[] = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
      for (let i = 0; i < 4; i++) {
        const [a, b] = overshoot(corners[i]!, corners[(i + 1) % 4]!, 2 + rand() * 3);
        parts.push(stroke(roughLine(a, b, rand)));
      }
      if (mark.label) parts.push(write(x + w / 2, y + h / 2, mark.label, 18));
      break;
    }
    case "text":
      parts.push(write(mark.x, mark.y, mark.text, mark.size ?? 20, "left"));
      break;
    case "arrow": {
      const { from, to } = mark;
      parts.push(stroke(roughLine(from, to, rand)));
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const head = Math.min(20, Math.hypot(to.x - from.x, to.y - from.y) * 0.35);
      for (const side of [-1, 1]) {
        const a = angle + Math.PI + side * (0.45 + jitter(rand, 0.06));
        parts.push(stroke(roughLine(to, { x: to.x + Math.cos(a) * head, y: to.y + Math.sin(a) * head }, rand, 0.3)));
      }
      if (mark.label) {
        // Above the shaft's middle (below it when the arrow points left, so it never sits upside down).
        const nx = Math.sin(angle);
        const ny = -Math.cos(angle);
        const flip = ny > 0 ? -1 : 1;
        // Far enough that the words' box clears a slanted shaft, not only a flat one.
        const size = 15;
        const away = 8 + (mark.label.length * size * 0.6 * Math.abs(nx)) / 2 + (size * 0.7 * Math.abs(ny));
        parts.push(write((from.x + to.x) / 2 + nx * away * flip, (from.y + to.y) / 2 + ny * away * flip, mark.label, size));
      }
      break;
    }
    case "line":
      parts.push(stroke(roughLine(mark.from, mark.to, rand)));
      break;
    case "circle":
      parts.push(stroke(roughRing({ x: mark.x, y: mark.y }, mark.r, rand, mark.ry ?? mark.r)));
      break;
    case "underline":
      parts.push(stroke(roughLine({ x: mark.x, y: mark.y }, { x: mark.x + mark.w, y: mark.y + jitter(rand, 2) }, rand, 1.6), PEN * 1.1));
      break;
    case "check": {
      const s = mark.size ?? 36;
      const { x, y } = mark;
      const down = roughLine({ x: x - s * 0.45, y: y - s * 0.02 }, { x: x - s * 0.12, y: y + s * 0.38 }, rand, 0.3);
      const up = roughLine({ x: x - s * 0.12, y: y + s * 0.38 }, { x: x + s * 0.5, y: y - s * 0.45 }, rand, 0.4);
      parts.push(stroke([...down, ...up.slice(1)], PEN * 1.2));
      break;
    }
    case "cross": {
      const s = (mark.size ?? 36) / 2;
      const { x, y } = mark;
      parts.push(stroke(roughLine({ x: x - s, y: y - s }, { x: x + s, y: y + s }, rand, 0.4), PEN * 1.2));
      parts.push(stroke(roughLine({ x: x + s, y: y - s }, { x: x - s, y: y + s }, rand, 0.4), PEN * 1.2));
      break;
    }
    case "step": {
      const r = 18;
      parts.push(stroke(roughRing({ x: mark.x, y: mark.y }, r, rand)));
      parts.push(write(mark.x, mark.y + 1, String(mark.n), 18));
      if (mark.label) parts.push(write(mark.x + r + 12, mark.y, mark.label, 17, "left"));
      break;
    }
  }
  return { color: INK_COLORS[mark.color ?? "ink"], parts, length: parts.reduce((sum, p) => sum + p.length, 0) };
}

// ---- drawing part of a stroke --------------------------------------------------------

/** The first `t` (0 to 1) of a stroke, by length, ending on an in-between point. */
export function partialPoints(points: Pt[], t: number): Pt[] {
  if (t >= 1) return points;
  const first = points[0];
  if (!first) return [];
  if (t <= 0) return [first];
  let left = pathLength(points) * t;
  const out: Pt[] = [first];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg >= left) {
      const k = seg ? left / seg : 0;
      out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
      return out;
    }
    out.push(b);
    left -= seg;
  }
  return out;
}

/** The pen's width along a stroke (0 to 1): thin where it lands and lifts, full in between. */
export function taper(t: number): number {
  const ramp = Math.max(0, Math.min(1, t / 0.12, (1 - t) / 0.2));
  return 0.45 + 0.55 * ramp;
}

/** Which parts of a mark show at progress `p` (0 to 1), and how far along each one is. */
export function partsAt(ink: Ink, p: number): { part: Part; t: number }[] {
  if (p >= 1) return ink.parts.map((part) => ({ part, t: 1 }));
  let left = ink.length * Math.max(0, p);
  const out: { part: Part; t: number }[] = [];
  for (const part of ink.parts) {
    if (left <= 0) break;
    const t = part.length ? Math.min(1, left / part.length) : 1;
    out.push({ part, t });
    left -= part.length;
  }
  return out;
}

// ---- timeline -------------------------------------------------------------------------

/** Pen speed in board units per second, and the bounds on one mark's time. */
export const PACE = { speed: 650, minMs: 280, maxMs: 1800, markGapMs: 140, beatGapMs: 380 } as const;

export interface Slot {
  start: number;
  end: number;
}

/**
 * When each new mark draws: one after another, starting now if the pen is free or
 * after the marks still drawing. Longer marks take longer. Reduced motion: all at once, now.
 */
export function planMarks(opts: { penFreeAt: number; now: number; lengths: number[]; newBeat: boolean; reducedMotion: boolean }): Slot[] {
  const { penFreeAt, now, lengths, newBeat, reducedMotion } = opts;
  if (reducedMotion) return lengths.map(() => ({ start: now, end: now }));
  let t = penFreeAt > now ? penFreeAt + (newBeat ? PACE.beatGapMs : PACE.markGapMs) : now;
  return lengths.map((length) => {
    const ms = Math.min(PACE.maxMs, Math.max(PACE.minMs, (length / PACE.speed) * 1000));
    const slot = { start: t, end: t + ms };
    t = slot.end + PACE.markGapMs;
    return slot;
  });
}
