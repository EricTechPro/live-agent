// Drawing v2: the layout pass (app/src/layout.ts). The model gives content and rough
// hints; code places everything. These tests feed deliberately overlapping and
// off-board model output and check that nothing on screen overlaps: cards, text
// boxes, the caption strip at the bottom, and the obstacles (the orb, marks on real UI).
import { expect, test } from "bun:test";
import type { Mark } from "../src/core/canvas.ts";
import { BOTTOM_FREE, GAP, inkHits, separateLoose, layoutCard, layoutScene, MARGIN, overlaps, placeCards, screenTextBoxes, SIZE_SCALE, toScreen, wrap, type Layout, type Rect } from "../app/src/layout.ts";
import type { SceneMark } from "../app/src/sketch.ts";

const VIEW = { width: 1440, height: 900 };
/** Mark kinds by id, so the checks know which strokes are crosses (meant to strike words through). */
const ownerKind = new Map<string, string>();
const sm = (mark: Record<string, unknown>, beatKey = "d1:0"): SceneMark => {
  ownerKind.set(String(mark.id), String(mark.kind));
  return { mark: mark as Mark, say: "line", beatKey };
};

const timeline = (id: string, n = 5) => ({
  kind: "timeline", id, title: "Timeline",
  items: Array.from({ length: n }, (_, i) => ({ label: `${1901 + i * 11} and a rather long label`, note: "Born in Pinar del Rio, Cuba, the son of a dock worker" })),
});
const list = (id: string) => ({
  kind: "list", id, title: "his legacy", heading: "Dockworkers union leader",
  items: [{ label: "Negotiated higher wages and paid leave" }, { label: "Rotating shift lists for fairness" }, { label: "Opposed mechanized cargo handling" }, { label: "Built a school and medical clinic" }],
});
const bars = (id: string) => ({ kind: "bars", id, title: "speed", unit: "ms", items: [{ label: "Gemini Live", value: 320 }, { label: "Whisper + GPT", value: 1450 }, { label: "Local", value: 90 }] });
const table = (id: string) => ({ kind: "table", id, title: "compare", columns: ["Tool", "Price", "Speed"], items: [{ label: "Jett", cells: ["Free", "Fast"] }, { label: "Roamies", cells: ["Free", "Fast enough for most people"] }] });
const flow = (id: string, n = 4) => ({ kind: "flow", id, title: "how it works", items: Array.from({ length: n }, (_, i) => ({ label: `Step number ${i + 1} does a thing`, note: "with a note" })) });
const diagram = (id: string) => ({ kind: "diagram", id, title: "graph", source: "flowchart LR\n a-->b", x: 0, y: 0, w: 1000, h: 600 });

/** Every overlap problem in a layout, as readable strings (empty = good). */
function problems(layout: Layout, view = VIEW, obstacles: Rect[] = []): string[] {
  const out: string[] = [];
  const { cards } = layout;
  for (const c of cards) {
    const r = c.rect;
    if (r.x < MARGIN - 0.01 || r.y < MARGIN - 0.01 || r.x + r.w > view.width - MARGIN + 0.01) out.push(`${c.id} off screen`);
    if (r.y + r.h > view.height - BOTTOM_FREE + 0.01) out.push(`${c.id} in the caption strip`);
    for (const o of obstacles) if (overlaps(r, o)) out.push(`${c.id} on an obstacle`);
    // Everything a card draws stays inside it.
    for (const { prim } of c.prims) {
      const box = prim.t === "text" ? prim.box : prim.t === "dot" ? { x: prim.x - prim.r, y: prim.y - prim.r, w: prim.r * 2, h: prim.r * 2 } : bbox(prim.pts);
      if (box.x < -1 || box.y < 0 || box.x + box.w > c.w + 1 || box.y + box.h > c.h + 1) out.push(`${c.id}: ${prim.t} spills out of the card`);
    }
  }
  for (let i = 0; i < cards.length; i++)
    for (let j = i + 1; j < cards.length; j++) if (overlaps(cards[i]!.rect, cards[j]!.rect, GAP - 0.01)) out.push(`${cards[i]!.id} overlaps ${cards[j]!.id}`);
  // No word sits on ink (a cross is the one mark meant to strike words through).
  for (const c of cards) {
    const crosses = new Set(c.owners.filter((o) => /cross/.test(ownerKind.get(o) ?? "")));
    const strokes = c.prims.flatMap((o) => (o.prim.t === "stroke" && !crosses.has(o.owner) ? [o.prim.pts] : []));
    c.prims.forEach((o, i) => {
      if (o.prim.t === "text" && inkHits(o.prim.box, strokes, 0)) out.push(`${c.id}: text ${i} "${o.prim.lines[0]}" crosses a stroke`);
    });
  }
  const texts = screenTextBoxes(layout);
  for (let i = 0; i < texts.length; i++)
    for (let j = i + 1; j < texts.length; j++) if (overlaps(texts[i]!, texts[j]!)) out.push(`text ${i} overlaps text ${j}`);
  return out;
}
const bbox = (pts: { x: number; y: number }[]): Rect => {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

test("wrap keeps every line within the width and ends a cut text with an ellipsis", () => {
  const lines = wrap("Supercalifragilisticexpialidocious is a very long word indeed and more", 80, 13, 3);
  expect(lines.length).toBeLessThanOrEqual(3);
  for (const l of lines) expect(l.length * 13 * 0.62).toBeLessThanOrEqual(80);
  expect(lines.at(-1)!.endsWith("…")).toBe(true);
});

test("timeline labels alternate above and below the line and never touch, even when long", () => {
  for (const n of [2, 3, 4, 5, 8]) {
    const c = layoutCard(timeline("p1", n) as never);
    const texts = c.prims.flatMap((o) => (o.prim.t === "text" ? [o.prim.box] : []));
    expect(texts).toHaveLength(n * 2);
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) expect(overlaps(texts[i]!, texts[j]!)).toBe(false);
    const axis = c.prims.find((o) => o.prim.t === "stroke")!.prim as { pts: { y: number }[] };
    const y = axis.pts[0]!.y;
    c.items.forEach((_, i) => {
      const label = texts[i * 2]!;
      expect(i % 2 === 0 ? label.y + label.h < y : label.y > y).toBe(true);
    });
  }
});

test("every card kind lays out with no overlapping words and nothing outside the card", () => {
  for (const m of [timeline("p1"), list("p1"), bars("p1"), table("p1"), flow("p1", 2), flow("p1", 6), diagram("p1")]) {
    const out = layoutScene({ marks: [sm(m)], view: VIEW });
    expect(problems(out)).toEqual([]);
    expect(out.cards).toHaveLength(1);
  }
});

test("cards go in columns, top to bottom then the next column, with a gap and never overlapping", () => {
  const marks = [timeline("p1"), list("p2"), bars("p3"), table("p4")].map((m, i) => sm(m, `d1:${i}`));
  const out = layoutScene({ marks, view: VIEW });
  expect(problems(out)).toEqual([]);
  const [a, b] = out.cards;
  expect(a!.rect).toMatchObject({ x: MARGIN, y: MARGIN });
  expect(b!.rect.x).toBe(MARGIN); // same column, below the first
  expect(b!.rect.y).toBeGreaterThanOrEqual(a!.rect.y + a!.rect.h + GAP);
});

test("at most 4 cards: a fifth closes the oldest", () => {
  const marks = [timeline("p1"), list("p2"), bars("p3"), table("p4"), flow("p5")].map((m, i) => sm(m, `d1:${i}`));
  const out = layoutScene({ marks, view: VIEW });
  expect(out.cards.map((c) => c.id)).toEqual(["p2", "p3", "p4", "p5"]);
  expect(out.evicted).toEqual(["p1"]);
  expect(problems(out)).toEqual([]);
});

test("the orb and screen-mark boxes are obstacles: cards go around them", () => {
  const obstacles = [{ x: 0, y: 0, w: 500, h: 300 }, { x: 600, y: 200, w: 300, h: 300 }];
  const marks = [timeline("p1"), list("p2"), bars("p3")].map((m, i) => sm(m, `d1:${i}`));
  const out = layoutScene({ marks, view: VIEW, obstacles });
  expect(out.cards).toHaveLength(3);
  expect(problems(out, VIEW, obstacles)).toEqual([]);
});

test("cards already on screen stay put when a new one comes", () => {
  const first = layoutScene({ marks: [sm(timeline("p1"))], view: VIEW });
  const prev = new Map(first.cards.map((c) => [c.id, c.rect]));
  const moved = { ...first.cards[0]!.rect, x: 400, y: 300 };
  const second = layoutScene({ marks: [sm(timeline("p1")), sm(list("p2"), "d2:0")], view: VIEW, prev: new Map([["p1", moved]]) });
  expect(second.cards[0]!.rect).toEqual(moved);
  expect(problems(second)).toEqual([]);
  expect(prev.size).toBe(1);
});

test("a small screen: cards shrink or close, but still never overlap or cover the caption strip", () => {
  for (const view of [{ width: 700, height: 500 }, { width: 420, height: 380 }, { width: 1024, height: 640 }]) {
    const marks = [timeline("p1", 8), list("p2"), bars("p3"), table("p4")].map((m, i) => sm(m, `d1:${i}`));
    const out = layoutScene({ marks, view });
    expect(out.cards.length).toBeGreaterThan(0);
    expect(problems(out, view)).toEqual([]);
  }
});

test("deliberately overlapping, off-board loose marks: one sketch card, words pushed apart", () => {
  // The old free sketch, the way a model gets it wrong: everything on top of everything, some off the board.
  const loose = [
    { kind: "box", id: "p1", x: 100, y: 100, w: 200, h: 100, label: "Microphone input" },
    { kind: "box", id: "p2", x: 110, y: 110, w: 200, h: 100, label: "Core thinking" },
    { kind: "text", id: "p3", x: 120, y: 150, text: "Overlapping words here" },
    { kind: "text", id: "p4", x: 125, y: 152, text: "And more words on top" },
    { kind: "step", id: "p5", x: 130, y: 150, n: 1, label: "Speak now" },
    { kind: "arrow", id: "p6", from: { x: 0, y: 0 }, to: { x: 1000, y: 600 }, label: "goes everywhere" },
    { kind: "text", id: "p7", x: 990, y: 595, text: "corner words that run off" },
    { kind: "circle", id: "p8", x: 0, y: 0, r: 300 },
  ];
  const out = layoutScene({ marks: loose.map((m) => sm(m)), view: VIEW });
  expect(out.cards).toHaveLength(1);
  expect(out.cards[0]!.kind).toBe("sketch");
  expect(problems(out)).toEqual([]);
});

test("loose shapes the model stacked on each other are pushed apart; an arrow from a moved box moves with it", () => {
  const out = separateLoose([
    { kind: "box", id: "p1", x: 100, y: 100, w: 200, h: 100, label: "A" },
    { kind: "box", id: "p2", x: 110, y: 110, w: 200, h: 100, label: "B" },
    { kind: "circle", id: "p3", x: 200, y: 150, r: 40 },
    { kind: "arrow", id: "p4", from: { x: 330, y: 230 }, to: { x: 600, y: 230 } }, // touches only the moved box
  ]);
  const boxes = out.filter((m) => m.kind !== "arrow").map((m) => (m.kind === "box" ? { x: m.x, y: m.y, w: m.w, h: m.h } : m.kind === "circle" ? { x: m.x - m.r, y: m.y - m.r, w: m.r * 2, h: m.r * 2 } : { x: 0, y: 0, w: 0, h: 0 }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i]!, boxes[j]!)).toBe(false);
  const arrow = out.find((m) => m.kind === "arrow")!;
  expect(arrow.kind === "arrow" && [arrow.from.x, arrow.from.y]).not.toEqual([330, 230]);
});

test("the shot-08 sketch: stacked boxes end up apart, the arrow label is off the arrow, notes keep off the boxes", () => {
  const marks = [
    { kind: "box", id: "p3", x: 100, y: 100, w: 260, h: 120, label: "Your voice" },
    { kind: "box", id: "p4", x: 120, y: 120, w: 260, h: 120, label: "Jett's core" },
    { kind: "text", id: "p5", x: 130, y: 160, text: "words on words" },
    { kind: "arrow", id: "p6", from: { x: 360, y: 160 }, to: { x: 700, y: 160 }, label: "streams" },
    { kind: "circle", id: "p7", x: 820, y: 170, r: 90 },
    { kind: "text", id: "p8", x: 1200, y: 700, text: "off the board" },
  ].map((m) => sm(m, "demo1:2"));
  const out = layoutScene({ marks, view: VIEW });
  expect(problems(out)).toEqual([]); // includes: no word crosses any stroke, no words overlap
  const [card] = out.cards;
  // The two boxes' drawn outlines, wobble and overshoot included, are clearly apart.
  const outline = (owner: string) => bbox(card!.prims.filter((o) => o.owner === owner && o.prim.t === "stroke").flatMap((o) => (o.prim as { pts: { x: number; y: number }[] }).pts));
  expect(overlaps(outline("p3"), outline("p4"), 6)).toBe(false);
  // Every word keeps at least a few px from all ink.
  const strokes = card!.prims.flatMap((o) => (o.prim.t === "stroke" ? [o.prim.pts] : []));
  for (const o of card!.prims) if (o.prim.t === "text") expect(inkHits(o.prim.box, strokes, 2)).toBe(false);
  // With a wider font (the browser measures Martian Mono wider than the default), each box still holds its label.
  for (const charW of [0.62, 0.75]) {
    const c = layoutScene({ marks, view: VIEW, charW }).cards[0]!;
    expect(problems({ cards: [c], screen: [], evicted: [] })).toEqual([]);
    for (const id of ["p3", "p4"]) {
      const frame = bbox(c.prims.filter((o) => o.owner === id && o.prim.t === "stroke").flatMap((o) => (o.prim as { pts: { x: number; y: number }[] }).pts));
      const label = c.prims.find((o) => o.owner === id && o.prim.t === "text")!.prim as { box: Rect };
      expect(label.box.x).toBeGreaterThan(frame.x);
      expect(label.box.y).toBeGreaterThan(frame.y);
      expect(label.box.x + label.box.w).toBeLessThan(frame.x + frame.w);
      expect(label.box.y + label.box.h).toBeLessThan(frame.y + frame.h);
    }
  }
});

test("a ring encloses its item's whole box with padding and never crosses its words", () => {
  const out = layoutScene({ marks: [sm(list("p1")), sm({ kind: "circle", id: "p2", on: "p1", item: 1 }), sm({ kind: "circle", id: "p3", on: "p1", item: 3 })], view: VIEW });
  const [card] = out.cards;
  for (const [owner, item] of [["p2", 0], ["p3", 2]] as const) {
    const loop = (card!.prims.find((o) => o.owner === owner)!.prim as { pts: { x: number; y: number }[] }).pts;
    const box = card!.items[item]!;
    expect(inkHits(box, [loop], 0)).toBe(false);
    // Each corner of the item is inside the loop (ray casting).
    const inside = (p: { x: number; y: number }) => {
      let c = false;
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const a = loop[i]!, b = loop[j]!;
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
      }
      return c;
    };
    for (const p of [{ x: box.x, y: box.y }, { x: box.x + box.w, y: box.y }, { x: box.x, y: box.y + box.h }, { x: box.x + box.w, y: box.y + box.h }]) expect(inside(p)).toBe(true);
  }
  expect(problems(out)).toEqual([]);
});

test("ink on cards: rings, underlines, checks and labels stay inside their card; labels never cover words", () => {
  const marks = [
    sm(list("p1")),
    sm({ kind: "circle", id: "p2", on: "p1", item: 2 }),
    sm({ kind: "underline", id: "p3", on: "p1", item: 1 }),
    sm({ kind: "check", id: "p4", on: "p1", item: 4 }),
    sm({ kind: "box", id: "p5", on: "p1", item: 3, label: "this one matters most of all" }),
    sm({ kind: "text", id: "p6", on: "p1", item: 1, text: "a note on the first line" }),
    sm({ kind: "circle", id: "p7", on: "p1", item: 99 }),
    sm(timeline("p8", 4), "d1:1"),
    sm({ kind: "step", id: "p9", on: "p8", item: 2, n: 3, label: "key moment" }, "d1:1"),
  ];
  const out = layoutScene({ marks, view: VIEW });
  expect(out.cards.map((c) => c.id)).toEqual(["p1", "p8"]);
  expect(out.cards[0]!.owners).toEqual(["p1", "p2", "p3", "p4", "p5", "p6", "p7"]);
  expect(problems(out)).toEqual([]);
});

test("an arrow between two cards runs edge to edge, its label clear of every card and word", () => {
  const marks = [sm(timeline("p1")), sm(list("p2")), sm({ kind: "arrow", id: "p3", on: "p1", to_card: "p2", label: "leads to" })];
  const out = layoutScene({ marks, view: VIEW });
  const arrow = out.screen.filter((o) => o.owner === "p3");
  expect(arrow.length).toBeGreaterThanOrEqual(3);
  const label = arrow.find((o) => o.prim.t === "text");
  if (label && label.prim.t === "text") for (const c of out.cards) expect(overlaps(label.prim.box, c.rect)).toBe(false);
  expect(problems(out)).toEqual([]);
});

test("an arrow between two cards never runs through a third card (it curves round, or is left out)", () => {
  const marks = [sm(timeline("p1")), sm(list("p2")), sm(bars("p3")), sm(flow("p4", 3)), sm({ kind: "arrow", id: "p5", on: "p2", to_card: "p4" })];
  const out = layoutScene({ marks, view: VIEW });
  const others = out.cards.filter((c) => c.id !== "p2" && c.id !== "p4").map((c) => c.rect);
  for (const o of out.screen) {
    if (o.prim.t !== "stroke") continue;
    for (const p of o.prim.pts) for (const r of others) expect(p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h).toBe(false);
  }
  expect(out.screen.length).toBeGreaterThan(0);
});

test("closed cards free their room and their ink goes with them", () => {
  const marks = [sm(timeline("p1")), sm({ kind: "circle", id: "p2", on: "p1" }), sm(list("p3"))];
  const out = layoutScene({ marks, view: VIEW, closed: new Set(["p1"]) });
  expect(out.cards.map((c) => c.id)).toEqual(["p3"]);
});

test("placeCards fills from the right when asked (the orb is on the left)", () => {
  const { rects } = placeCards([{ id: "a", w: 300, h: 200 }], VIEW, [], new Map(), "right");
  expect(rects.get("a")!.rect.x + 300).toBe(VIEW.width - MARGIN);
});

test("a zoomed card takes its scale and keeps its spot; past the screen's height its rect stops and the contents scroll", () => {
  const prev = new Map([["a", { x: MARGIN, y: MARGIN, w: 300, h: 200, scale: 1 }]]);
  const { rects } = placeCards([{ id: "a", w: 300, h: 200, k: 1.5 }], VIEW, [], prev);
  expect(rects.get("a")).toEqual({ rect: { x: MARGIN, y: MARGIN, w: 450, h: 300 }, scale: 1.5 });
  const tall = placeCards([{ id: "a", w: 300, h: 500, k: 2.5 }], VIEW, [], prev).rects.get("a")!;
  expect(tall.scale).toBe(2.5);
  expect(tall.rect.h).toBe(VIEW.height - MARGIN * 2 - BOTTOM_FREE);
  // Never wider than the screen.
  const wide = placeCards([{ id: "a", w: 900, h: 100, k: 3 }], VIEW, [], prev).rects.get("a")!;
  expect(wide.rect.w).toBeLessThanOrEqual(VIEW.width - MARGIN * 2);
});

test("pinned cards never close to make room; the oldest unpinned one goes", () => {
  const sizes = ["a", "b", "c", "d", "e"].map((id) => ({ id, w: 300, h: 200 }));
  expect(placeCards(sizes, VIEW, [], new Map(), "left", 4).evicted).toEqual(["a"]);
  expect(placeCards(sizes, VIEW, [], new Map(), "left", 4, [], { pinned: new Set(["a"]) }).evicted).toEqual(["b"]);
});

test("while a card is zoomed (lead), the others shrink to make room before any closes", () => {
  const view = { width: 800, height: 600 };
  const prev = new Map([["a", { x: MARGIN, y: MARGIN, w: 380, h: 250, scale: 1 }], ["b", { x: MARGIN, y: 274, w: 380, h: 250, scale: 1 }]]);
  const sizes = [{ id: "a", w: 380, h: 250, k: 1.6 }, { id: "b", w: 380, h: 250 }];
  const { rects, evicted } = placeCards(sizes, view, [], prev, "left", 6, [], { lead: "a" });
  expect(evicted).toEqual([]);
  expect(rects.get("a")!.scale).toBe(1.6);
  expect(rects.get("b")!.scale).toBeLessThan(1);
  expect(overlaps(rects.get("a")!.rect, rects.get("b")!.rect)).toBe(false);
});

test("card_size sets the scale a card opens at", () => {
  const big = layoutScene({ marks: [sm({ ...list("p1"), card_size: "large" })], view: VIEW });
  const small = layoutScene({ marks: [sm({ ...list("p1"), card_size: "small" })], view: VIEW });
  expect(big.cards[0]!.scale).toBeCloseTo(SIZE_SCALE.large);
  expect(small.cards[0]!.scale).toBeCloseTo(SIZE_SCALE.small);
});

test("many random overlapping calls: no overlap, ever (fuzz)", () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const makers = [timeline, list, bars, table, flow, diagram] as ((id: string) => Record<string, unknown>)[];
  for (let run = 0; run < 60; run++) {
    const view = { width: 600 + Math.floor(rnd() * 1400), height: 420 + Math.floor(rnd() * 700) };
    const marks: SceneMark[] = [];
    let n = 1;
    for (let k = 0; k < 1 + Math.floor(rnd() * 6); k++) {
      const id = `p${n++}`;
      marks.push(sm(makers[Math.floor(rnd() * makers.length)]!(id), `d${run}:${k}`));
      if (rnd() < 0.5) marks.push(sm({ kind: "circle", id: `p${n++}`, on: id, item: 1 + Math.floor(rnd() * 3) }, `d${run}:${k}`));
      if (rnd() < 0.3) marks.push(sm({ kind: "text", id: `p${n++}`, x: rnd() * 1200 - 100, y: rnd() * 800 - 100, text: "loose words" }, `d${run}:${k}`));
    }
    const obstacles = rnd() < 0.5 ? [{ x: view.width - 200, y: view.height - 300, w: 180, h: 200 }] : [];
    const out = layoutScene({ marks, view, obstacles });
    expect(problems(out, view, obstacles)).toEqual([]);
    for (const c of out.cards) expect(toScreen({ x: 0, y: 0, w: c.w, h: c.h }, c)).toEqual(c.rect);
  }
});
