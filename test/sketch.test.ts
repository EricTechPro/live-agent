// The sketch canvas renderer's pure parts (ticket 32): the scene reducer
// (marks by id, from `canvas.beat` events), fitting the 1000 x 600 board into the
// panel, the pen strokes each mark kind turns into, and the drawing timeline.
import { expect, test } from "bun:test";
import { BOARD as CORE_BOARD, type Mark } from "../src/core/canvas.ts";
import type { AgentEvent } from "../src/core/events.ts";
import {
  addCanvasEvent,
  BOARD,
  emptyScene,
  fitBoard,
  inkFor,
  INK_COLORS,
  partialPoints,
  pathLength,
  planMarks,
  seededRandom,
  taper,
} from "../app/src/sketch.ts";

const beat = (beatIndex: number, marks: Mark[], say = `line ${beatIndex}`, id = "c1"): AgentEvent => ({
  type: "canvas.beat", id, beat: beatIndex, say, marks,
});
const box = (id: string, x = 100): Mark => ({ kind: "box", id, x, y: 100, w: 200, h: 100, label: "Mic" });

// ---- scene reducer ----------------------------------------------------------

test("the canvas starts empty", () => {
  expect(emptyScene.marks).toEqual([]);
});

test("a beat adds its marks in order, each tagged with its beat and say line", () => {
  const scene = addCanvasEvent(emptyScene, beat(0, [box("p1"), box("p2", 400)], "First the mic"));
  expect(scene.marks.map((m) => m.mark.id)).toEqual(["p1", "p2"]);
  expect(scene.marks[0]).toMatchObject({ say: "First the mic", beatKey: "c1:0" });
});

test("a later beat adds to the canvas instead of replacing it", () => {
  const scene = [beat(0, [box("p1")]), beat(1, [box("p2", 400)]), beat(0, [box("p3", 700)], "next call", "c2")].reduce(
    addCanvasEvent,
    emptyScene,
  );
  expect(scene.marks.map((m) => m.mark.id)).toEqual(["p1", "p2", "p3"]);
});

test("a mark with an id already on the canvas replaces it in place", () => {
  const scene = [beat(0, [box("p1"), box("p2", 400)]), beat(1, [{ ...box("p1"), color: "red" }])].reduce(addCanvasEvent, emptyScene);
  expect(scene.marks.map((m) => m.mark.id)).toEqual(["p1", "p2"]);
  expect(scene.marks[0]!.mark.color).toBe("red");
});

test("chat.started clears the canvas", () => {
  const drawn = addCanvasEvent(emptyScene, beat(0, [box("p1")]));
  expect(addCanvasEvent(drawn, { type: "chat.started" } as AgentEvent).marks).toEqual([]);
});

test("other events leave the scene untouched (same object)", () => {
  const drawn = addCanvasEvent(emptyScene, beat(0, [box("p1")]));
  expect(addCanvasEvent(drawn, { type: "turn.done", reply: "" })).toBe(drawn);
});

test("canvas.edit swaps in the changed mark, keeping its place, beat and say line", () => {
  const drawn = addCanvasEvent(emptyScene, beat(0, [box("p1"), box("p2", 400)], "Two boxes"));
  const edited = addCanvasEvent(drawn, { type: "canvas.edit", id: "e1", change: { color: "red" }, mark: { ...box("p2", 400), color: "red" } });
  expect(edited.marks.map((m) => m.mark.id)).toEqual(["p1", "p2"]);
  expect(edited.marks[1]).toMatchObject({ mark: { color: "red" }, say: "Two boxes", beatKey: "c1:0" });
});

test("canvas.edit for an id the window does not have changes nothing", () => {
  const drawn = addCanvasEvent(emptyScene, beat(0, [box("p1")]));
  expect(addCanvasEvent(drawn, { type: "canvas.edit", id: "e1", change: {}, mark: box("p7") })).toBe(drawn);
});

test("canvas.erase removes the named marks; erase all empties the canvas", () => {
  const drawn = addCanvasEvent(emptyScene, beat(0, [box("p1"), box("p2", 400), box("p3", 700)]));
  expect(addCanvasEvent(drawn, { type: "canvas.erase", id: "e1", ids: ["p2"], all: false }).marks.map((m) => m.mark.id)).toEqual(["p1", "p3"]);
  expect(addCanvasEvent(drawn, { type: "canvas.erase", id: "e1", ids: ["p1", "p2", "p3"], all: true }).marks).toEqual([]);
});

// ---- fitting the board -------------------------------------------------------

test("the window's board is the core's board", () => {
  expect(BOARD).toEqual(CORE_BOARD);
});

test("the board scales to fit the panel and keeps its 5:3 shape, centred", () => {
  expect(fitBoard(500, 600)).toEqual({ scale: 0.5, width: 500, height: 300, x: 0, y: 150 });
  expect(fitBoard(2000, 600)).toEqual({ scale: 1, width: 1000, height: 600, x: 500, y: 0 });
});

test("a zero-size panel gives a zero scale, not NaN", () => {
  expect(fitBoard(0, 0).scale).toBe(0);
});

// ---- deterministic wobble ----------------------------------------------------

test("the wobble is seeded by the mark id: same id, same numbers", () => {
  const a = seededRandom("p1");
  const b = seededRandom("p1");
  const c = seededRandom("p2");
  const seqA = [a(), a(), a()];
  expect([b(), b(), b()]).toEqual(seqA);
  expect([c(), c(), c()]).not.toEqual(seqA);
  for (const n of seqA) expect(n >= 0 && n < 1).toBe(true);
});

test("redrawing a mark gives exactly the same strokes (no jitter on resize)", () => {
  const m: Mark = { kind: "circle", id: "p4", x: 500, y: 300, r: 80 };
  expect(inkFor(m)).toEqual(inkFor(m));
});

// ---- strokes per mark kind ---------------------------------------------------

const all: Mark[] = [
  { kind: "box", id: "p1", x: 100, y: 100, w: 200, h: 100, label: "Mic" },
  { kind: "text", id: "p2", x: 100, y: 300, text: "hello" },
  { kind: "arrow", id: "p3", from: { x: 300, y: 150 }, to: { x: 500, y: 150 }, label: "audio" },
  { kind: "line", id: "p4", from: { x: 100, y: 500 }, to: { x: 900, y: 500 } },
  { kind: "circle", id: "p5", x: 700, y: 300, r: 60 },
  { kind: "underline", id: "p6", x: 100, y: 320, w: 120 },
  { kind: "check", id: "p7", x: 800, y: 100 },
  { kind: "cross", id: "p8", x: 900, y: 100, size: 40 },
  { kind: "step", id: "p9", x: 60, y: 60, n: 1, label: "Ask" },
];

test("every mark kind turns into at least one pen stroke or written text", () => {
  for (const m of all) {
    const ink = inkFor(m);
    expect(ink.parts.length).toBeGreaterThan(0);
    expect(ink.length).toBeGreaterThan(0);
  }
});

test("shapes draw the strokes you'd expect: box 4 sides, arrow shaft and 2 head strokes, cross 2, check 1", () => {
  const strokes = (m: Mark) => inkFor(m).parts.filter((p) => p.kind === "stroke").length;
  expect(strokes(all[0]!)).toBe(4);
  expect(strokes(all[2]!)).toBe(3);
  expect(strokes(all[7]!)).toBe(2);
  expect(strokes(all[6]!)).toBe(1);
  expect(strokes(all[4]!)).toBe(1);
});

test("labels and text are written after their strokes", () => {
  const boxParts = inkFor(all[0]!).parts;
  expect(boxParts.at(-1)).toMatchObject({ kind: "text", text: "Mic" });
  const step = inkFor(all[8]!).parts.filter((p) => p.kind === "text").map((p) => (p.kind === "text" ? p.text : ""));
  expect(step).toEqual(["1", "Ask"]);
});

test("strokes stay close to the shape: a box's corners are within a few units of the real corners", () => {
  const sides = inkFor(all[0]!).parts.flatMap((p) => (p.kind === "stroke" ? [p.points] : []));
  const first = sides[0]![0]!;
  expect(Math.abs(first.x - 100)).toBeLessThan(10);
  expect(Math.abs(first.y - 100)).toBeLessThan(10);
  for (const side of sides) for (const pt of side) {
    expect(pt.x).toBeGreaterThan(85);
    expect(pt.x).toBeLessThan(315);
    expect(pt.y).toBeGreaterThan(85);
    expect(pt.y).toBeLessThan(215);
  }
});

test("a ring stays near its radius and closes on itself", () => {
  const ring = inkFor(all[4]!).parts[0]!;
  if (ring.kind !== "stroke") throw new Error("ring should be a stroke");
  for (const pt of ring.points) {
    const d = Math.hypot(pt.x - 700, pt.y - 300);
    expect(d).toBeGreaterThan(50);
    expect(d).toBeLessThan(70);
  }
  // It goes a little past a full turn, like a real pen.
  expect(pathLength(ring.points)).toBeGreaterThan(2 * Math.PI * 60);
});

test("every colour has an ink that reads on the dark teal background", () => {
  expect(Object.keys(INK_COLORS).sort()).toEqual(["blue", "green", "ink", "orange", "purple", "red"]);
  expect(inkFor({ ...all[0]!, color: "red" } as Mark).color).toBe(INK_COLORS.red);
  expect(inkFor(all[0]!).color).toBe(INK_COLORS.ink);
});

// ---- partial strokes and taper -----------------------------------------------

const L = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];

test("pathLength adds up the segments", () => {
  expect(pathLength(L)).toBe(20);
});

test("partialPoints cuts a stroke at a fraction of its length, ending on an in-between point", () => {
  expect(partialPoints(L, 0)).toEqual([{ x: 0, y: 0 }]);
  expect(partialPoints(L, 0.25)).toEqual([{ x: 0, y: 0 }, { x: 5, y: 0 }]);
  expect(partialPoints(L, 0.75)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }]);
  expect(partialPoints(L, 1)).toEqual(L);
});

test("the pen tapers: thin at both ends, full in the middle", () => {
  expect(taper(0)).toBeLessThan(0.6);
  expect(taper(1)).toBeLessThan(0.6);
  expect(taper(0.5)).toBe(1);
});

// ---- timeline -----------------------------------------------------------------

test("marks of a beat are drawn one after another, starting now when the pen is idle", () => {
  const plan = planMarks({ penFreeAt: 0, now: 1000, lengths: [100, 300], newBeat: true, reducedMotion: false });
  expect(plan[0]!.start).toBeGreaterThanOrEqual(1000);
  expect(plan[1]!.start).toBeGreaterThan(plan[0]!.end);
  expect(plan[1]!.end - plan[1]!.start).toBeGreaterThan(plan[0]!.end - plan[0]!.start);
});

test("a beat that arrives while the pen is busy waits for it", () => {
  const plan = planMarks({ penFreeAt: 5000, now: 1000, lengths: [100], newBeat: true, reducedMotion: false });
  expect(plan[0]!.start).toBeGreaterThanOrEqual(5000);
});

test("with reduced motion every mark is done the moment it arrives", () => {
  const plan = planMarks({ penFreeAt: 5000, now: 1000, lengths: [100, 300], newBeat: true, reducedMotion: true });
  expect(plan).toEqual([{ start: 1000, end: 1000 }, { start: 1000, end: 1000 }]);
});
