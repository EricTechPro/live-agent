// Drawing v2 layout: the model says WHAT, this file decides WHERE. Pure, like sketch.ts.
//
//   const out = layoutScene({ marks: scene.marks, view, obstacles, prev });
//   out.cards     // each card's screen rect, plus its content as primitives in card-local px
//   out.screen    // ink in full-screen px (arrows between cards; later: marks on real UI)
//   out.evicted   // cards closed to keep at most MAX_CARDS up
//
// Guarantees (test/layout.test.ts feeds it overlapping and off-board model output):
//   - cards never overlap each other, the obstacles, or the screen's edges
//   - the bottom BOTTOM_FREE px stay free for the caption bar
//   - no two text boxes overlap, inside a card or across cards
//   - at most MAX_CARDS cards; the oldest go first
//
// How: every card kind lays its own content out from data (timeline labels alternate
// above and below a line in their own columns, lists wrap, bars share a scale ...),
// so its size is known. Then cards go on the screen column by column: top to bottom
// in the first free column, then the next column just right of the cards so far.
// Cards already on screen stay where they are. Loose marks with board hints (the old
// free sketch) become one "sketch" card per draw call, their words pushed apart.
//
// Text is measured as monospace (Martian Mono): width = chars x size x charW. The
// window measures charW from the real font once it has loaded and passes it in.
//
// The seam for screen awareness (a later slice): marks aimed at real on-screen UI live
// in `screen` (full-screen px), and their boxes come in as `obstacles`, which cards avoid.
// Idea from Roamies (AGPL): idea only, our own code.
import { MAX_CARDS, isCard } from "../../src/core/card-kinds.ts";
import type { Mark } from "../../src/core/canvas.ts";
import { inkFor, roughLine, roughRing, seededRandom, type InkMark, type Pt, type Rand, type SceneMark } from "./sketch.ts";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Size {
  width: number;
  height: number;
}

/** Room around cards and from the screen's edges, in px. */
export const MARGIN = 12;
/** Space between cards. */
export const GAP = 12;
/** Kept free at the bottom of the screen for the caption bar. */
export const BOTTOM_FREE = 64;
/** Card chrome: title bar height and inner padding. */
export const CHROME = { bar: 26, pad: 14 } as const;
/** Default monospace advance (em) for Martian Mono; the window measures the real one. */
export const CHAR_W = 0.62;
/** Default advance (em) for Doto, the dot-matrix display face used for headings. */
export const DISPLAY_W = 0.6;
export const LINE = 1.38;

export type Tone = "ink" | "text" | "dim" | "hot" | "deep";

export type Prim =
  | { t: "stroke"; pts: Pt[]; width: number; tone: Tone }
  | { t: "dot"; x: number; y: number; r: number; tone: Tone }
  | { t: "text"; box: Rect; lines: string[]; size: number; weight: number; align: "left" | "center" | "right"; tone: Tone; font?: "display" };

/** A primitive plus the mark it belongs to (its pen timing comes from that mark). */
export interface Owned {
  owner: string;
  prim: Prim;
}

export interface CardContent {
  id: string;
  kind: string;
  title: string;
  w: number;
  h: number;
  /** Card-local px (0,0 is the card's top-left corner, the title bar included). */
  prims: Owned[];
  /** Each item's box, card-local, for ink aimed at `item`. */
  items: Rect[];
  /** Where an HTML body goes (Mermaid), card-local. */
  body?: Rect;
  /** Mark ids drawn with this card (the card and the ink on it). */
  owners: string[];
  color?: string;
}

export interface PlacedCard extends CardContent {
  /** Screen px. Content is drawn scaled by `scale` from the card's top-left. */
  rect: Rect;
  scale: number;
}

export interface Layout {
  cards: PlacedCard[];
  screen: Owned[];
  evicted: string[];
}

export interface LayoutInput {
  marks: SceneMark[];
  view: Size;
  /** Screen rects cards must avoid: the orb, open popovers, the caption bar, marks on real UI. */
  obstacles?: Rect[];
  /** Where cards already are (by card id); they stay put while they still fit. */
  prev?: ReadonlyMap<string, Rect & { scale?: number }>;
  /** Card ids the user closed. */
  closed?: ReadonlySet<string>;
  /** Fill columns from this side (the side away from the orb). */
  from?: "left" | "right";
  charW?: number;
  /** Cards kept at once (default MAX_CARDS). */
  max?: number;
  /** Doto's advance (em), measured by the window. */
  displayW?: number;
  /** Rendered Mermaid sizes by card id (card-view measures them). */
  diagrams?: ReadonlyMap<string, { w: number; h: number }>;
}

// ---- geometry --------------------------------------------------------------------

export const overlaps = (a: Rect, b: Rect, gap = 0) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

const union = (rs: Rect[]): Rect | undefined => {
  if (!rs.length) return undefined;
  const x = Math.min(...rs.map((r) => r.x));
  const y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
};
const inside = (r: Rect, view: Size) =>
  r.x >= MARGIN - 0.01 && r.y >= MARGIN - 0.01 && r.x + r.w <= view.width - MARGIN + 0.01 && r.y + r.h <= view.height - BOTTOM_FREE + 0.01;

// ---- text ---------------------------------------------------------------------------

export function textWidth(text: string, size: number, charW = CHAR_W) {
  return text.length * size * charW;
}

/** Greedy word wrap to `maxW` px, at most `maxLines` (the last one ends in … when cut). */
export function wrap(text: string, maxW: number, size: number, maxLines = 3, charW = CHAR_W): string[] {
  const per = Math.max(1, Math.floor(maxW / (size * charW)));
  const lines: string[] = [];
  let cur = "";
  for (let word of text.trim().split(/\s+/)) {
    while (word.length > per) {
      if (cur) lines.push(cur), (cur = "");
      lines.push(word.slice(0, per));
      word = word.slice(per);
    }
    const next = cur ? `${cur} ${word}` : word;
    if (next.length <= per) cur = next;
    else {
      lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1]!;
    kept[maxLines - 1] = (last.length >= per ? last.slice(0, per - 1) : last) + "…";
    return kept;
  }
  return lines;
}

interface TextOpts {
  size?: number;
  weight?: number;
  align?: "left" | "center" | "right";
  tone?: Tone;
  maxLines?: number;
  font?: "display";
}

/**
 * A text primitive. `x` is the left edge (align left), the centre (center) or the
 * right edge (right); `y` the top. Its box is exactly the wrapped lines' extent.
 */
function textAt(text: string, x: number, y: number, maxW: number, charW: number, o: TextOpts = {}): Prim & { t: "text" } {
  const size = o.size ?? 13;
  const lines = wrap(text, maxW, size, o.maxLines ?? 3, charW);
  const w = Math.max(...lines.map((l) => textWidth(l, size, charW)));
  const h = lines.length * size * LINE;
  const align = o.align ?? "left";
  const left = align === "left" ? x : align === "center" ? x - w / 2 : x - w;
  return { t: "text", box: { x: left, y, w, h }, lines, size, weight: o.weight ?? 400, align, tone: o.tone ?? "text", ...(o.font ? { font: o.font } : {}) };
}

// ---- hand-drawn helpers -----------------------------------------------------------

const stroke = (pts: Pt[], width = 4, tone: Tone = "ink"): Prim => ({ t: "stroke", pts, width, tone });

function roughRect(r: Rect, rand: Rand, width = 2.5): Prim[] {
  const c: Pt[] = [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
  return [0, 1, 2, 3].map((i) => stroke(roughLine(c[i]!, c[(i + 1) % 4]!, rand, 0.5), width));
}

function arrowPrims(from: Pt, to: Pt, rand: Rand, width = 3): Prim[] {
  const out = [stroke(roughLine(from, to, rand, 0.6), width)];
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = Math.min(12, Math.hypot(to.x - from.x, to.y - from.y) * 0.4);
  for (const side of [-1, 1]) {
    const a = angle + Math.PI + side * (0.5 + (rand() - 0.5) * 0.1);
    out.push(stroke(roughLine(to, { x: to.x + Math.cos(a) * head, y: to.y + Math.sin(a) * head }, rand, 0.2), width));
  }
  return out;
}

// ---- card kinds ---------------------------------------------------------------------

type CardMark = Extract<Mark, { kind: "timeline" | "list" | "flow" | "bars" | "table" | "diagram" }>;
const { bar: BAR, pad: PAD } = CHROME;

/** One card's content, laid out from its data. Card-local px. */
export function layoutCard(m: CardMark, charW = CHAR_W, displayW = DISPLAY_W, diagram?: { w: number; h: number }): CardContent {
  const rand = seededRandom(m.id);
  const prims: Prim[] = [];
  const items: Rect[] = [];
  const base = { id: m.id, kind: m.kind, title: (m.title ?? m.kind).toLowerCase(), owners: [m.id], color: m.color };
  const top = BAR + PAD;
  const lh = (size: number, lines: number) => size * LINE * lines;

  switch (m.kind) {
    case "timeline": {
      const n = m.items.length;
      const col = Math.min(132, Math.max(72, Math.floor(540 / n)));
      const w = PAD * 2 + col * n;
      // A label owns two columns (neighbours on its side are two dots away); the end
      // ones hug the card's edges with one and a half.
      const span = (i: number) => (n > 1 && (i === 0 || i === n - 1) ? col * 1.5 : col * 2) - GAP;
      const cx = (i: number) => PAD + col * (i + 0.5);
      const anchor = (i: number) =>
        i === 0 && n > 1 ? { x: PAD, align: "left" as const } : i === n - 1 && n > 1 ? { x: w - PAD, align: "right" as const } : { x: cx(i), align: "center" as const };
      // Measure first: each side is as tall as its tallest label + note.
      const blocks = m.items.map((it, i) => {
        const a = anchor(i);
        const label = textAt(it.label, a.x, 0, span(i), charW, { size: 13, align: a.align, maxLines: 2 });
        const note = it.note ? textAt(it.note, a.x, 0, span(i), charW, { size: 11, align: a.align, tone: "dim", maxLines: 3 }) : undefined;
        return { label, note, h: label.box.h + (note ? note.box.h + 2 : 0), above: i % 2 === 0 };
      });
      const aboveH = Math.max(0, ...blocks.filter((b) => b.above).map((b) => b.h));
      const belowH = Math.max(0, ...blocks.filter((b) => !b.above).map((b) => b.h));
      const axisY = top + aboveH + 14;
      const h = axisY + 14 + belowH + PAD;
      prims.push(stroke(roughLine({ x: PAD - 2, y: axisY }, { x: w - PAD + 2, y: axisY + (rand() - 0.5) * 2 }, rand, 0.8), 4));
      blocks.forEach((b, i) => {
        const x = cx(i);
        const dot: Prim = { t: "dot", x, y: axisY, r: 5.5, tone: "ink" };
        // Above: note on top, label next to the line. Below: label next to the line, note under it.
        if (b.above) {
          const ly = axisY - 14 - b.label.box.h;
          b.label.box.y = ly;
          if (b.note) b.note.box.y = ly - 2 - b.note.box.h;
        } else {
          b.label.box.y = axisY + 14;
          if (b.note) b.note.box.y = axisY + 14 + b.label.box.h + 2;
        }
        prims.push(dot, b.label, ...(b.note ? [b.note] : []));
        items.push(union([b.label.box, ...(b.note ? [b.note.box] : [])])!);
      });
      return { ...base, w, h, prims: own(m.id, prims), items };
    }

    case "list": {
      const w = 340;
      const gutter = 26; // room on the right for a check mark
      const textW = w - PAD * 2 - gutter;
      let y = top;
      if (m.heading) {
        const head = textAt(m.heading, PAD, y, textW, displayW, { size: 19, weight: 800, maxLines: 2, font: "display" });
        prims.push(head);
        y += head.box.h + 10;
      }
      m.items.forEach((it, i) => {
        const bullet = textAt(m.numbered ? `${i + 1}.` : "–", PAD, y, 24, charW, { size: 13, tone: "ink", weight: 700 });
        const label = textAt(it.label, PAD + 26, y, textW - 26, charW, { size: 13, maxLines: 3 });
        const parts: Prim[] = [bullet, label];
        let rowH = label.box.h;
        if (it.note) {
          const note = textAt(it.note, PAD + 26, y + rowH + 2, textW - 26, charW, { size: 11, tone: "dim", maxLines: 2 });
          parts.push(note);
          rowH += note.box.h + 2;
        }
        prims.push(...parts);
        // The item is where its words are, so a ring hugs them instead of the whole row.
        items.push(union(parts.map((p) => (p as Prim & { t: "text" }).box))!);
        y += rowH + 8;
      });
      return { ...base, w, h: y - 8 + PAD, prims: own(m.id, prims), items };
    }

    case "flow": {
      const n = m.items.length;
      const across = n <= 3;
      const boxW = across ? 128 : 236;
      const arrow = across ? 34 : 26;
      const inner = boxW - 16;
      const blocks = m.items.map((it) => {
        const label = textAt(it.label, 0, 0, inner, charW, { size: 13, align: "center", maxLines: 3 });
        const note = it.note ? textAt(it.note, 0, 0, inner, charW, { size: 11, align: "center", tone: "dim", maxLines: 2 }) : undefined;
        return { label, note, h: label.box.h + (note ? note.box.h + 2 : 0) + 18 };
      });
      const rowH = Math.max(...blocks.map((b) => b.h));
      let x = PAD;
      let y = top;
      blocks.forEach((b, i) => {
        const boxH = across ? rowH : b.h;
        const r = { x, y, w: boxW, h: boxH };
        prims.push(...roughRect(r, rand));
        const cx = x + boxW / 2;
        const ty = y + (boxH - (b.h - 18)) / 2;
        place(b.label, cx, ty);
        prims.push(b.label);
        if (b.note) {
          place(b.note, cx, ty + b.label.box.h + 2);
          prims.push(b.note);
        }
        items.push(r);
        if (i < n - 1) {
          if (across) prims.push(...arrowPrims({ x: x + boxW + 5, y: y + boxH / 2 }, { x: x + boxW + arrow - 5, y: y + boxH / 2 }, rand));
          else prims.push(...arrowPrims({ x: cx, y: y + boxH + 4 }, { x: cx, y: y + boxH + arrow - 4 }, rand));
        }
        if (across) x += boxW + arrow;
        else y += boxH + arrow;
      });
      const w = across ? x - arrow + PAD : PAD * 2 + boxW;
      const h = across ? top + rowH + PAD : y - arrow + PAD;
      return { ...base, w, h, prims: own(m.id, prims), items };
    }

    case "bars": {
      const w = 360;
      const unit = m.unit ?? "";
      const values = m.items.map((it) => it.value ?? 0);
      const max = Math.max(...values, 0) || 1;
      const fmt = (v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)}${unit}`;
      const labelW = Math.min(112, Math.max(...m.items.map((it) => textWidth(it.label, 12, charW))) + 4);
      const valueW = Math.max(...values.map((v) => textWidth(fmt(v), 11, charW))) + 4;
      const x0 = PAD + labelW + 10;
      const track = w - PAD - valueW - 8 - x0;
      let y = top;
      m.items.forEach((it, i) => {
        const label = textAt(it.label, PAD, y, labelW, charW, { size: 12, maxLines: 2 });
        const rowH = Math.max(label.box.h, 20);
        const cy = y + rowH / 2;
        const len = Math.max(4, (track * values[i]!) / max);
        const bar = stroke(roughLine({ x: x0, y: cy }, { x: x0 + len, y: cy }, rand, 0.4), 9);
        const value = textAt(fmt(values[i]!), x0 + len + 8, cy - 11 * LINE / 2, valueW, charW, { size: 11, tone: "dim", maxLines: 1 });
        label.box.y = cy - label.box.h / 2;
        prims.push(label, bar, value);
        items.push(union([label.box, value.box, { x: x0, y: cy - 5, w: len, h: 10 }])!);
        y += rowH + 10;
      });
      return { ...base, w, h: y - 10 + PAD, prims: own(m.id, prims), items };
    }

    case "table": {
      const cols = m.columns.length;
      const rows = m.items.map((it) => [it.label, ...(it.cells ?? [])].slice(0, cols));
      const want = m.columns.map((c, j) => Math.max(textWidth(c, 11, charW), ...rows.map((r) => textWidth(r[j] ?? "", 13, charW))) + 12);
      const total = want.reduce((a, b) => a + b, 0);
      const innerW = Math.min(440, Math.max(240, total));
      const widths = want.map((v) => (v / total) * innerW);
      const w = innerW + PAD * 2;
      const xs = widths.map((_, j) => PAD + widths.slice(0, j).reduce((a, b) => a + b, 0));
      let y = top;
      const heads = m.columns.map((c, j) => textAt(c, xs[j]!, y, widths[j]! - 10, charW, { size: 11, tone: "dim", weight: 500, maxLines: 2 }));
      prims.push(...heads);
      y += Math.max(...heads.map((h) => h.box.h)) + 6;
      prims.push(stroke(roughLine({ x: PAD - 2, y }, { x: w - PAD + 2, y }, rand, 0.4), 2));
      y += 8;
      rows.forEach((r) => {
        const cells = r.map((c, j) => textAt(c || "–", xs[j]!, y, widths[j]! - 10, charW, { size: 13, maxLines: 3, tone: j === 0 ? "text" : "text" }));
        prims.push(...cells);
        const rowH = Math.max(...cells.map((c) => c.box.h));
        items.push(union(cells.map((c) => c.box))!);
        y += rowH + 8;
      });
      return { ...base, w, h: y - 8 + PAD, prims: own(m.id, prims), items };
    }

    case "diagram": {
      // Sized to the rendered diagram (card-view measures it), scaled down to fit at most
      // 500 x 360; a guess from the source until the first render lands.
      const natural = diagram ?? guessDiagram(m.source);
      const k = Math.min(1, 500 / natural.w, 360 / natural.h);
      const bw = Math.max(180, Math.round(natural.w * k));
      const bh = Math.max(60, Math.round(natural.h * k));
      const w = bw + PAD * 2;
      const h = top + bh + PAD;
      const body = { x: PAD, y: top, w: bw, h: bh };
      return { ...base, w, h, prims: [], items: [body], body };
    }
  }
}

/** A first guess at a Mermaid diagram's size from its source: nodes in a row or a column. */
export function guessDiagram(source: string): { w: number; h: number } {
  const nodes = new Set(source.match(/\b[A-Za-z_][\w]*(?=\s*[[({>]|\s*-->|\s*---|\s*$)/gm) ?? []).size || 4;
  const across = /^\s*(flowchart|graph)\s+(LR|RL)/m.test(source);
  return across ? { w: Math.min(520, 90 * nodes), h: 150 } : { w: 260, h: Math.min(380, 70 * nodes) };
}

/** Centre a text primitive's box on x, top at y. */
function place(p: Prim & { t: "text" }, cx: number, y: number) {
  p.box.x = cx - p.box.w / 2;
  p.box.y = y;
}

const own = (owner: string, prims: Prim[]): Owned[] => prims.map((prim) => ({ owner, prim }));

// ---- ink: resolving marks into strokes ----------------------------------------------

/** Turn sketch.ts ink (board-like parts) into primitives, scaled by s around (ox, oy). */
function inkPrims(mark: InkMark, s: number, ox: number, oy: number, charW: number, width = 4.5): Prim[] {
  const ink = inkFor(mark);
  return ink.parts.map((part): Prim => {
    if (part.kind === "stroke") return stroke(part.points.map((p) => ({ x: ox + p.x * s, y: oy + p.y * s })), width);
    const size = Math.max(11, Math.round(part.size * s));
    const x = ox + part.x * s;
    const t = textAt(part.text, x, 0, 260, charW, { size, align: part.align === "center" ? "center" : "left", tone: "ink", weight: 500, maxLines: 2 });
    t.box.y = oy + part.y * s - t.box.h / 2;
    return t;
  });
}

const textBoxes = (prims: Owned[]) => prims.flatMap((o) => (o.prim.t === "text" ? [o.prim.box] : []));

/** Move each text box (in order) down until it clears every box before it and every `fixed` box. */
function separateTexts(prims: Owned[], fixed: Rect[] = [], step = 4): void {
  const placed: Rect[] = [...fixed];
  for (const o of prims) {
    if (o.prim.t !== "text") continue;
    const box = o.prim.box;
    let guard = 0;
    while (placed.some((b) => overlaps(box, b, 2)) && guard++ < 2000) box.y += step;
    placed.push(box);
  }
}

/** Free spot for a text box near `around`: below, above, right, left, then further down. Card-local. */
function spotFor(text: Prim & { t: "text" }, around: Rect, taken: Rect[], bounds: Rect): void {
  const { w, h } = text.box;
  const tries: Pt[] = [
    { x: around.x, y: around.y + around.h + 4 },
    { x: around.x, y: around.y - h - 4 },
    { x: around.x + around.w + 8, y: around.y + (around.h - h) / 2 },
    { x: around.x - w - 8, y: around.y + (around.h - h) / 2 },
  ];
  for (const t of tries) {
    const box = { x: Math.max(bounds.x, Math.min(t.x, bounds.x + bounds.w - w)), y: t.y, w, h };
    if (box.y >= bounds.y && box.y + h <= bounds.y + bounds.h && !taken.some((b) => overlaps(box, b, 2))) {
      text.box = box;
      return;
    }
  }
  // Nothing free beside it: under everything (the card grows to fit).
  text.box = { x: bounds.x, y: Math.max(...taken.map((b) => b.y + b.h), around.y + around.h) + 6, w, h };
}

const color = (m: Mark) => (m as { color?: InkMark["color"] }).color;

/** Ink aimed at a card (and an item of it): drawn around that item, inside the card. Mutates the card (it may grow). */
function inkOnCard(card: CardContent, mark: Mark, charW: number): void {
  const r = mark as Mark & { item?: number; label?: string; text?: string; n?: number };
  // No item (or one past the end): the mark is about the whole card, every word in it.
  const target = (r.item && card.items[r.item - 1]) || union([...card.items, ...textBoxes(card.prims)]) || { x: PAD, y: BAR + PAD, w: card.w - PAD * 2, h: card.h - BAR - PAD * 2 };
  const bounds = { x: 4, y: BAR + 4, w: card.w - 8, h: card.h - BAR - 8 };
  const rand = seededRandom(mark.id);
  const c = color(mark);
  const out: Prim[] = [];
  const clampX = (x: number) => Math.max(bounds.x, Math.min(bounds.x + bounds.w, x));
  const clampY = (y: number) => Math.max(bounds.y, Math.min(bounds.y + bounds.h, y));
  switch (mark.kind) {
    case "circle": {
      // A loose loop that encloses the item's whole box and never runs through any words:
      // its padding shrinks until it clears the neighbouring lines too.
      const others = textBoxes(card.prims).filter((b) => !(b.x >= target.x - 1 && b.y >= target.y - 1 && b.x + b.w <= target.x + target.w + 1 && b.y + b.h <= target.y + target.h + 1));
      let loop: Pt[] = [];
      for (const [px, py] of [[9, 7], [7, 5], [5, 3.5], [3.5, 2.5], [2.5, 1.5]] as const) {
        loop = roughLoop(target, seededRandom(mark.id), bounds, px, py);
        if (!others.some((b) => inkHits(b, [loop], 0))) break;
      }
      out.push(stroke(loop, 4.5));
      break;
    }
    case "underline": {
      // Close under the words, with only a gentle waver, so it never reaches the next line.
      const y = clampY(target.y + target.h + 2.5);
      const pts = roughLine({ x: target.x, y }, { x: target.x + target.w, y }, rand, 0.4).map((q) => ({ x: q.x, y: y + Math.max(-1.2, Math.min(1.2, q.y - y)) }));
      out.push(stroke(pts, 4));
      break;
    }
    case "box": {
      const pad = 5;
      const x = clampX(target.x - pad);
      const y = clampY(target.y - pad);
      out.push(...roughRect({ x, y, w: clampX(target.x + target.w + pad) - x, h: clampY(target.y + target.h + pad) - y }, rand, 3.5));
      break;
    }
    case "check":
    case "cross": {
      const size = 18;
      // In the card's right margin (lists keep a gutter for it), level with the item.
      const x = Math.min(card.w - PAD - size / 2 + 6, target.x + target.w + size / 2 + 4);
      const y = target.y + Math.min(target.h, 22) / 2;
      out.push(...inkPrims({ kind: mark.kind, id: mark.id, x: Math.min(x, bounds.x + bounds.w - size / 2), y, size, color: c }, 1, 0, 0, charW));
      break;
    }
    case "step": {
      const x = Math.min(bounds.x + bounds.w - 20, target.x + target.w + 16);
      const k = 0.7; // a small badge: the step's ring scaled down around its own spot
      out.push(...inkPrims({ kind: "step", id: mark.id, x: x / k, y: (target.y + 12) / k, n: r.n ?? 1, color: c }, k, 0, 0, charW));
      break;
    }
    case "text":
      break;
    default:
      return;
  }
  // Words that come with the mark (a text note, a box or step label) find a free spot.
  const words = mark.kind === "text" ? r.text : r.label;
  if (words) {
    const t = textAt(words, 0, 0, Math.min(240, card.w - PAD * 2), charW, { size: 12, tone: "ink", weight: 500, maxLines: 2 });
    spotFor(t, target, textBoxes(card.prims), { x: PAD, y: BAR + 4, w: card.w - PAD * 2, h: card.h - BAR - 8 });
    const strokes = [...card.prims.map((o) => o.prim), ...out].flatMap((q) => (q.t === "stroke" ? [q.pts] : []));
    clearOfInk(t, textBoxes(card.prims), strokes, { x: PAD, y: BAR + 4, w: card.w - PAD * 2, h: 1e5 });
    out.push(t);
    card.h = Math.max(card.h, t.box.y + t.box.h + PAD);
  }
  // A wobbly loop may swing a few px wide: keep every point inside the card.
  for (const p of out)
    if (p.t === "stroke") p.pts = p.pts.map((q) => ({ x: Math.max(3, Math.min(card.w - 3, q.x)), y: Math.max(BAR + 3, Math.min(card.h - 3, q.y)) }));
  card.prims.push(...own(mark.id, out));
  card.owners.push(mark.id);
}

/** Does the segment a-b cross (or touch, within pad) the rect? */
function segHits(a: Pt, b: Pt, r: Rect, pad = 0): boolean {
  const x0 = r.x - pad, y0 = r.y - pad, x1 = r.x + r.w + pad, y1 = r.y + r.h + pad;
  const inside = (p: Pt) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  if (inside(a) || inside(b)) return true;
  // Liang-Barsky clip.
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  for (const [pp, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]] as const) {
    if (pp === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / pp;
    if (pp < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/** Does any stroke (as polylines) cross the rect? Strokes are about 5px wide: `pad` keeps words clear of the ink. */
export function inkHits(r: Rect, strokes: Pt[][], pad = 4): boolean {
  for (const pts of strokes) for (let i = 1; i < pts.length; i++) if (segHits(pts[i - 1]!, pts[i]!, r, pad)) return true;
  return false;
}

/**
 * Move a word box to the nearest spot (up, down, right, left, growing) inside `bounds`
 * where it crosses no stroke and no other word box. Last resort: below everything.
 */
function clearOfInk(t: Prim & { t: "text" }, texts: Rect[], strokes: Pt[][], bounds: Rect): void {
  const free = (b: Rect) => !inkHits(b, strokes) && !texts.some((o) => o !== t.box && overlaps(b, o, 2));
  if (free(t.box)) return;
  const fits = (b: Rect) => b.x >= bounds.x && b.y >= bounds.y && b.x + b.w <= bounds.x + bounds.w && b.y + b.h <= bounds.y + bounds.h;
  for (let r = 4; r <= 400; r += 4)
    for (const [dx, dy] of [[0, -r], [0, r], [r, 0], [-r, 0], [r, -r], [-r, -r], [r, r], [-r, r]] as const) {
      const b = { ...t.box, x: t.box.x + dx, y: t.box.y + dy };
      if (fits(b) && free(b)) {
        t.box = b;
        return;
      }
    }
  const bottom = Math.max(...strokes.flat().map((p) => p.y), ...texts.map((o) => o.y + o.h), bounds.y);
  t.box = { ...t.box, x: bounds.x, y: bottom + 10 };
}

/**
 * A hand-drawn loop round a rect that never cuts into it: a rounded "squircle" just
 * big enough to hold the rect's corners, a little more than a full turn so the ends
 * overlap, wobbling only outwards. Clamped into `bounds` (the card).
 */
export function roughLoop(r: Rect, rand: Rand, bounds?: Rect, padX = 9, padY = 7): Pt[] {
  const a = r.w / 2 + padX;
  const b = r.h / 2 + padY;
  // The roundest loop whose outline still clears the rect's corners.
  let n = 2.2;
  while (n < 12 && Math.pow(r.w / 2 / a, n) + Math.pow(r.h / 2 / b, n) > 0.8) n += 0.4;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const from = -Math.PI * 0.75 + (rand() - 0.5) * 0.6;
  const sweep = Math.PI * 2 + 0.45 + rand() * 0.25;
  const phase = rand() * Math.PI * 2;
  const pts: Pt[] = [];
  const steps = Math.max(48, Math.ceil((a + b) / 3));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const th = from + sweep * t;
    const c = Math.cos(th);
    const sn = Math.sin(th);
    // Outward-only wobble, and the tail drifts out a little so the ends cross.
    const k = 1 + 0.015 * (1 + Math.sin(3 * th + phase)) + 0.03 * t;
    pts.push({
      x: cx + a * k * Math.sign(c) * Math.pow(Math.abs(c), 2 / n),
      y: cy + b * k * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n),
    });
  }
  if (!bounds) return pts;
  return pts.map((q) => ({ x: Math.max(bounds.x, Math.min(bounds.x + bounds.w, q.x)), y: Math.max(bounds.y, Math.min(bounds.y + bounds.h, q.y)) }));
}

/** Loose marks with board hints: one "sketch" card, the hints fitted inside it, words pushed apart. */
function sketchCard(id: string, marks: Mark[], charW: number): CardContent {
  // The scale depends on the sketch's extent and a box must hold its label at that scale,
  // so settle both together: grow boxes to fit their words, push shapes apart, rescale.
  const raw = marks.flatMap((m) => resolveLoose(m));
  let resolved = raw;
  let box: Rect = { x: 0, y: 0, w: 0, h: 0 };
  let s = 1;
  for (let pass = 0; pass < 4; pass++) {
    const grown: { from: Rect; dw: number; dh: number }[] = [];
    const sized = raw.map((m) => {
      if (m.kind !== "box" || !m.label) return m;
      const size = Math.max(11, Math.round(18 * s));
      const w = Math.max(m.w, (textWidth(m.label, size, charW) + 24) / s);
      const h = Math.max(m.h, (size * LINE + 20) / s);
      if (w > m.w || h > m.h) grown.push({ from: { x: m.x, y: m.y, w: m.w, h: m.h }, dw: w - m.w, dh: h - m.h });
      return { ...m, w, h };
    });
    // Arrow and line ends on a grown box's right or bottom side move out with that side.
    const edge = (p: Pt): Pt => {
      const g = grown.find((b) => p.x >= b.from.x - 24 && p.x <= b.from.x + b.from.w + 24 && p.y >= b.from.y - 24 && p.y <= b.from.y + b.from.h + 24);
      if (!g) return p;
      return { x: p.x + (p.x > g.from.x + g.from.w / 2 ? g.dw : 0), y: p.y + (p.y > g.from.y + g.from.h / 2 ? g.dh : 0) };
    };
    resolved = separateLoose(sized.map((m) => (m.kind === "arrow" || m.kind === "line" ? { ...m, from: edge(m.from), to: edge(m.to) } : m)));
    box = union(resolved.flatMap(bboxPoints).map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))!;
    const next = Math.min(1, 440 / Math.max(box.w, 120), 280 / Math.max(box.h, 60));
    if (Math.abs(next - s) < 0.005) break;
    s = next;
  }
  const prims: Owned[] = [];
  const bw = Math.max(box.w, 120);
  const bh = Math.max(box.h, 60);
  const ox = PAD + 6 - box.x * s;
  const oy = BAR + PAD + 6 - box.y * s;
  for (const m of resolved) prims.push(...own(m.id, inkPrims(m, s, ox, oy, charW, 4)));
  separateTexts(prims);
  // Words that end up past the right edge come back inside; separate again after.
  const maxW = Math.max(bw * s, ...textBoxes(prims).map((b) => b.w)) + PAD * 2 + 12;
  for (const b of textBoxes(prims)) b.x = Math.max(PAD, Math.min(b.x, maxW - PAD - b.w));
  separateTexts(prims);
  // No word sits on ink: each one moves to the nearest clear spot (labels off arrows, notes off boxes).
  const strokes = prims.flatMap((o) => (o.prim.t === "stroke" ? [o.prim.pts] : []));
  for (const o of prims) if (o.prim.t === "text") clearOfInk(o.prim, textBoxes(prims), strokes, { x: PAD, y: BAR + 6, w: maxW - PAD * 2, h: 1e5 });
  const w = Math.max(200, maxW);
  const all = prims.flatMap((o) => (o.prim.t === "text" ? [o.prim.box] : o.prim.t === "stroke" ? [union(o.prim.pts.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))!] : []));
  const h = Math.max(BAR + PAD + bh * s + PAD + 12, ...all.map((r) => r.y + r.h + PAD));
  return { id, kind: "sketch", title: "sketch", w, h, prims, items: [], owners: marks.map((m) => m.id) };
}

/** Shapes that must not sit on each other in a loose sketch (lines and arrows may cross them). */
const SOLID = new Set(["box", "circle", "step", "text", "check", "cross"]);
/** Board units between loose shapes: room for the pen's overshoot and wobble even scaled down. */
const LOOSE_GAP = 44;

const boxOf = (m: InkMark): Rect => union(bboxPoints(m).map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })))!;

function moved(m: InkMark, dx: number, dy: number): InkMark {
  if (m.kind === "arrow" || m.kind === "line") return { ...m, from: { x: m.from.x + dx, y: m.from.y + dy }, to: { x: m.to.x + dx, y: m.to.y + dy } };
  return { ...m, x: m.x + dx, y: m.y + dy } as InkMark;
}

/**
 * The model's loose shapes, pushed apart: each solid shape (box, ring, words ...) that lands
 * on an earlier one moves to the nearest free spot (right, below, then further out).
 * Arrow and line ends that touched a moved shape move with it.
 */
export function separateLoose(marks: InkMark[]): InkMark[] {
  const out: InkMark[] = [];
  const placed: Rect[] = [];
  const shifts: { from: Rect; dx: number; dy: number }[] = [];
  for (const m of marks) {
    if (!SOLID.has(m.kind)) {
      out.push(m);
      continue;
    }
    const box = boxOf(m);
    let best = { dx: 0, dy: 0 };
    if (placed.some((p) => overlaps(box, p, LOOSE_GAP))) {
      let found = false;
      for (let ring = 1; ring <= 40 && !found; ring++) {
        const d = ring * 28;
        // Right, below, left, above, then the diagonals, at growing distance.
        for (const [dx, dy] of [[d, 0], [0, d], [-d, 0], [0, -d], [d, d], [-d, d], [d, -d], [-d, -d]] as const) {
          const r = { ...box, x: box.x + dx, y: box.y + dy };
          if (r.x < -200 || r.y < -200) continue;
          if (!placed.some((p) => overlaps(r, p, LOOSE_GAP))) {
            best = { dx, dy };
            found = true;
            break;
          }
        }
      }
    }
    const next = best.dx || best.dy ? moved(m, best.dx, best.dy) : m;
    shifts.push({ from: box, ...best });
    placed.push(boxOf(next));
    out.push(next);
  }
  // Ends of arrows and lines follow the shape they were drawn from or to.
  // An end touching a shape that stayed put stays put; else it goes with the nearest shape that moved.
  const near = (p: Pt, r: Rect) => p.x >= r.x - 24 && p.x <= r.x + r.w + 24 && p.y >= r.y - 24 && p.y <= r.y + r.h + 24;
  const follow = (p: Pt): Pt => {
    const touching = shifts.filter((sh) => near(p, sh.from));
    if (!touching.length || touching.some((sh) => !sh.dx && !sh.dy)) return p;
    const s = touching[0]!;
    return { x: p.x + s.dx, y: p.y + s.dy };
  };
  return out.map((m) => (m.kind === "arrow" || m.kind === "line" ? { ...m, from: follow(m.from), to: follow(m.to) } : m));
}

function bboxPoints(m: InkMark): Pt[] {
  switch (m.kind) {
    case "box":
      return [{ x: m.x, y: m.y }, { x: m.x + m.w, y: m.y + m.h }];
    case "arrow":
    case "line":
      return [m.from, m.to];
    case "circle":
      return [{ x: m.x - m.r, y: m.y - m.r }, { x: m.x + m.r, y: m.y + m.r }];
    case "underline":
      return [{ x: m.x, y: m.y }, { x: m.x + m.w, y: m.y }];
    case "text":
      return [{ x: m.x, y: m.y - 12 }, { x: m.x + m.text.length * 11, y: m.y + 12 }];
    case "step":
      return [{ x: m.x - 18, y: m.y - 18 }, { x: m.x + 18 + (m.label?.length ?? 0) * 11, y: m.y + 18 }];
    default:
      return [{ x: m.x - 20, y: m.y - 20 }, { x: m.x + 20, y: m.y + 20 }];
  }
}

/** A loose mark's hints as a full InkMark (missing numbers get a sensible default). */
function resolveLoose(m: Mark): InkMark[] {
  const r = m as Record<string, unknown> & { id: string };
  const n = (k: string, d: number) => (typeof r[k] === "number" ? (r[k] as number) : d);
  const p = (k: string, d: Pt): Pt => (r[k] as Pt | undefined) ?? d;
  const c = color(m);
  switch (m.kind) {
    case "box":
      return [{ kind: "box", id: m.id, x: n("x", 0), y: n("y", 0), w: n("w", 160), h: n("h", 80), label: m.label, color: c }];
    case "text":
      return [{ kind: "text", id: m.id, x: n("x", 0), y: n("y", 0), text: m.text, size: m.size, color: c }];
    case "arrow":
      return [{ kind: "arrow", id: m.id, from: p("from", { x: 0, y: 0 }), to: p("to", { x: 100, y: 0 }), label: m.label, color: c }];
    case "line":
      return [{ kind: "line", id: m.id, from: p("from", { x: 0, y: 0 }), to: p("to", { x: 100, y: 0 }), color: c }];
    case "circle":
      return [{ kind: "circle", id: m.id, x: n("x", 0), y: n("y", 0), r: n("r", 40), color: c }];
    case "underline":
      return [{ kind: "underline", id: m.id, x: n("x", 0), y: n("y", 0), w: n("w", 100), color: c }];
    case "check":
    case "cross":
      return [{ kind: m.kind, id: m.id, x: n("x", 0), y: n("y", 0), size: m.size, color: c }];
    case "step":
      return [{ kind: "step", id: m.id, x: n("x", 0), y: n("y", 0), n: m.n, label: m.label, color: c }];
    default:
      return [];
  }
}

// ---- placing cards on the screen -------------------------------------------------------

/**
 * Put cards (oldest first) on the screen with no overlap. Cards in `prev` stay put while
 * they still fit; new ones go column by column (top to bottom, then the next column).
 * More than `max` cards, or no room: the oldest close. A card too big for the screen is
 * scaled down. Returns screen rects, scales and the closed ids.
 */
export function placeCards(
  sizes: { id: string; w: number; h: number }[],
  view: Size,
  obstacles: Rect[] = [],
  prev: ReadonlyMap<string, Rect & { scale?: number }> = new Map(),
  from: "left" | "right" = "left",
  max = MAX_CARDS,
): { rects: Map<string, { rect: Rect; scale: number }>; evicted: string[] } {
  const evicted = sizes.slice(0, Math.max(0, sizes.length - max)).map((s) => s.id);
  let live = sizes.slice(Math.max(0, sizes.length - max));
  // Work left to right; mirror for the right side.
  const mirror = (r: Rect): Rect => (from === "left" ? r : { ...r, x: view.width - r.x - r.w });
  const obs = obstacles.map(mirror);
  const rects = new Map<string, { rect: Rect; scale: number }>();
  const freeOf = (r: Rect, others: Rect[]) =>
    inside(r, view) && !obs.some((o) => overlaps(r, o, 10)) && !others.some((o) => overlaps(r, o, GAP));

  for (let i = 0; i < live.length; i++) {
    const card = live[i]!;
    const taken = () => [...rects.values()].map((v) => v.rect);
    const old = prev.get(card.id);
    if (old) {
      const at = mirror(old);
      // It keeps its spot and its scale; only its size follows its content.
      const scale = old.scale ?? 1;
      const rect = { x: at.x, y: at.y, w: card.w * scale, h: card.h * scale };
      if (freeOf(rect, taken())) {
        rects.set(card.id, { rect, scale });
        continue;
      }
    }
    let scale = Math.min(1, (view.width - MARGIN * 2) / card.w, (view.height - MARGIN - BOTTOM_FREE) / card.h);
    let spot: Rect | undefined;
    for (;;) {
      spot = findSpot(card.w * scale, card.h * scale, taken(), obs, view);
      if (spot) break;
      // No room: close the oldest card on screen, else shrink this one.
      const oldest = live.slice(0, i).find((c) => rects.has(c.id));
      if (oldest) {
        rects.delete(oldest.id);
        evicted.push(oldest.id);
        continue;
      }
      if (scale < 0.2) break;
      scale *= 0.85;
    }
    if (spot) rects.set(card.id, { rect: spot, scale });
    else evicted.push(card.id);
  }
  live = live.filter((c) => rects.has(c.id));
  const out = new Map<string, { rect: Rect; scale: number }>();
  for (const c of live) {
    const v = rects.get(c.id)!;
    out.set(c.id, { rect: mirror(v.rect), scale: v.scale });
  }
  return { rects: out, evicted };
}

const STEP = 12;

function findSpot(w: number, h: number, taken: Rect[], obstacles: Rect[], view: Size): Rect | undefined {
  const bottom = view.height - BOTTOM_FREE;
  const xs = [...new Set([MARGIN, ...taken.map((r) => r.x + r.w + GAP), ...obstacles.map((o) => o.x + o.w + 10)])]
    .filter((x) => x >= MARGIN && x + w <= view.width - MARGIN)
    .sort((a, b) => a - b);
  for (const x of xs) {
    for (let y = MARGIN; y + h <= bottom + 0.01; y += STEP) {
      const r = { x, y, w, h };
      if (taken.some((t) => overlaps(r, t, GAP)) || obstacles.some((o) => overlaps(r, o, 10))) continue;
      return r;
    }
  }
  return undefined;
}

// ---- the whole scene ------------------------------------------------------------------------

/** Lay out every live card, the ink on them, loose sketches, and arrows between cards. */
export function layoutScene(input: LayoutInput): Layout {
  const charW = input.charW ?? CHAR_W;
  const closed = input.closed ?? new Set<string>();
  const contents: CardContent[] = [];
  const byId = new Map<string, CardContent>();
  const loose = new Map<string, Mark[]>();
  const between: SceneMark[] = [];

  for (const sm of input.marks) {
    const m = sm.mark;
    const r = m as { on?: string; to_card?: string };
    if (isCard(m)) {
      if (closed.has(m.id)) continue;
      const c = layoutCard(m as CardMark, charW, input.displayW ?? DISPLAY_W, input.diagrams?.get(m.id));
      contents.push(c);
      byId.set(m.id, c);
    } else if (r.to_card && r.on) {
      between.push(sm);
    } else if (r.on) {
      const card = byId.get(r.on);
      if (card) inkOnCard(card, m, charW);
    } else {
      // Loose: one sketch card per draw call, where its first mark came.
      const key = `sketch:${sm.beatKey.split(":")[0]}`;
      if (closed.has(key)) continue;
      if (!loose.has(key)) {
        loose.set(key, []);
        contents.push({ id: key, kind: "sketch", title: "sketch", w: 0, h: 0, prims: [], items: [], owners: [] });
      }
      loose.get(key)!.push(m);
    }
  }
  const all = contents.map((c) => (c.kind === "sketch" && loose.has(c.id) ? sketchCard(c.id, loose.get(c.id)!, charW) : c));

  const { rects, evicted } = placeCards(
    all.map((c) => ({ id: c.id, w: c.w, h: c.h })),
    input.view,
    input.obstacles,
    input.prev,
    input.from,
    input.max,
  );
  const cards: PlacedCard[] = all.flatMap((c) => {
    const at = rects.get(c.id);
    return at ? [{ ...c, rect: at.rect, scale: at.scale }] : [];
  });

  // Arrows between two cards on screen: edge to edge, words where nothing else is.
  const screen: Owned[] = [];
  const placedById = new Map(cards.map((c) => [c.id, c]));
  const taken: Rect[] = [...cards.map((c) => c.rect), ...cards.flatMap((c) => textBoxes(c.prims).map((b) => toScreen(b, c)))];
  for (const sm of between) {
    const m = sm.mark as Mark & { on: string; to_card: string; label?: string };
    const a = placedById.get(m.on);
    const b = placedById.get(m.to_card);
    if (!a || !b || a === b) continue;
    const others = cards.filter((c) => c !== a && c !== b).map((c) => c.rect);
    const path = routeBetween(a.rect, b.rect, others, input.view);
    if (!path) continue; // no clear way round: better no arrow than one through a card
    const rand = seededRandom(m.id);
    const from = path[0]!;
    const to = path.at(-1)!;
    const shaft = path.length === 2 ? roughLine(from, to, rand) : path;
    const prims: Prim[] = [stroke(shaft, 4)];
    if (m.kind === "arrow") prims.push(...headAt(path.at(-2)!, to, rand, 4));
    if (m.label) {
      const t = textAt(m.label, 0, 0, 200, charW, { size: 12, tone: "ink", weight: 500, maxLines: 2 });
      const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      spotFor(t, { x: mid.x - t.box.w / 2, y: mid.y - 6, w: t.box.w, h: 12 }, taken, {
        x: MARGIN, y: MARGIN, w: input.view.width - MARGIN * 2, h: input.view.height - BOTTOM_FREE - MARGIN,
      });
      clearOfInk(t, taken, [shaft], { x: MARGIN, y: MARGIN, w: input.view.width - MARGIN * 2, h: input.view.height - BOTTOM_FREE - MARGIN });
      if (!taken.some((r) => overlaps(t.box, r, 2)) && !inkHits(t.box, [shaft]) && inside(t.box, input.view)) {
        prims.push(t);
        taken.push(t.box);
      }
    }
    screen.push(...own(m.id, prims));
  }
  return { cards, screen, evicted };
}

const centre = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

function headAt(prev: Pt, to: Pt, rand: Rand, width: number): Prim[] {
  const angle = Math.atan2(to.y - prev.y, to.x - prev.x);
  return [-1, 1].map((side) => {
    const a = angle + Math.PI + side * (0.5 + (rand() - 0.5) * 0.1);
    return stroke(roughLine(to, { x: to.x + Math.cos(a) * 13, y: to.y + Math.sin(a) * 13 }, rand, 0.2), width);
  });
}

const hits = (pts: Pt[], rects: Rect[]) =>
  pts.some((p) => rects.some((r) => p.x > r.x - 4 && p.x < r.x + r.w + 4 && p.y > r.y - 4 && p.y < r.y + r.h + 4));

/** Sample a path every few px (for hit tests). */
function sample(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6));
    for (let k = 0; k <= n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n });
  }
  return out;
}

/**
 * A way from card a to card b that crosses no other card and stays on screen:
 * straight edge to edge if that is clear, else a curve round the right or left
 * of both cards. Undefined when neither is clear.
 */
export function routeBetween(a: Rect, b: Rect, others: Rect[], view: Size): Pt[] | undefined {
  const straight = [edgeToward(a, centre(b)), edgeToward(b, centre(a))];
  if (!hits(sample(straight), others)) return straight;
  for (const side of [1, -1]) {
    const x0 = side > 0 ? a.x + a.w + 6 : a.x - 6;
    const x1 = side > 0 ? b.x + b.w + 6 : b.x - 6;
    const out = side > 0 ? Math.max(a.x + a.w, b.x + b.w) + 34 : Math.min(a.x, b.x) - 34;
    if (out < MARGIN || out > view.width - MARGIN) continue;
    const p0 = { x: x0, y: a.y + a.h / 2 };
    const p3 = { x: x1, y: b.y + b.h / 2 };
    const curve: Pt[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const u = 1 - t;
      // Cubic Bezier: out sideways from a, along, back in to b.
      curve.push({
        x: u * u * u * p0.x + 3 * u * u * t * out + 3 * u * t * t * out + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * p0.y + 3 * u * t * t * p3.y + t * t * t * p3.y,
      });
    }
    // A little hand wobble across the curve.
    const wobbly = curve.map((p, i) => (i === 0 || i === curve.length - 1 ? p : { x: p.x + Math.sin(i * 1.7) * 1.2, y: p.y + Math.cos(i * 1.3) * 1.2 }));
    if (!hits(sample(wobbly), others)) return wobbly;
  }
  return undefined;
}

/** Where the line from a rect's centre toward `p` leaves the rect (plus a few px). */
export function edgeToward(r: Rect, p: Pt): Pt {
  const c = centre(r);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  const k = 1 / Math.max(Math.abs(dx) / (r.w / 2 + 8) || 0, Math.abs(dy) / (r.h / 2 + 8) || 0, 1e-6);
  return { x: c.x + dx * Math.min(k, 1e6), y: c.y + dy * Math.min(k, 1e6) };
}

/** A card-local rect in screen px. */
export function toScreen(b: Rect, card: { rect: Rect; scale: number }): Rect {
  return { x: card.rect.x + b.x * card.scale, y: card.rect.y + b.y * card.scale, w: b.w * card.scale, h: b.h * card.scale };
}

/** Every text box on screen, in screen px (tests and the label placer use it). */
export function screenTextBoxes(layout: Layout): Rect[] {
  return [
    ...layout.cards.flatMap((c) => textBoxes(c.prims).map((b) => toScreen(b, c))),
    ...textBoxes(layout.screen),
  ];
}
