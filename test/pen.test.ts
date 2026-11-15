// Ticket 34, window side: the pen's clock (app/src/pen.ts). A beat's strokes
// spread over the time its line takes to say (caption length / speaking rate),
// start on the core's `canvas.speak`, wait a little for it otherwise, speed up
// when the voice is ahead, and stop on an interruption.
import { expect, test } from "bun:test";
import { beatMs, emptyPen, penAddBeat, penInterrupt, penSpeak, slotOf, VOICE, type Pen } from "../app/src/pen.ts";

const SHORT = "Mic to core.";
const LONG = "The microphone sends your voice to the core, which thinks and then answers out loud.";
const add = (pen: Pen, key: string, say: string, ids: string[], now: number, reduced = false) =>
  penAddBeat(pen, { key, say, ids, lengths: ids.map(() => 300) }, now, reduced);
const end = (pen: Pen, ids: string[]) => Math.max(...ids.map((id) => slotOf(pen, id)!.end));

test("a beat lasts about as long as its line takes to say, within bounds", () => {
  expect(beatMs(LONG)).toBeGreaterThan(beatMs(SHORT));
  expect(beatMs(LONG)).toBeCloseTo((LONG.length / VOICE.charsPerSec) * 1000, -2);
  expect(beatMs("Hi.")).toBe(VOICE.minBeatMs);
  expect(beatMs("word ".repeat(400))).toBe(VOICE.maxBeatMs);
});

test("the speaking rate is a parameter: a slower voice gives a longer beat (the hook for real audio timing)", () => {
  expect(beatMs(LONG, VOICE.charsPerSec / 2)).toBeGreaterThan(beatMs(LONG));
});

test("the first beat starts at once, its marks one after another, finishing about when the line ends", () => {
  const pen = add(emptyPen, "c1:0", LONG, ["p1", "p2", "p3"], 1000);
  const [a, b, c] = ["p1", "p2", "p3"].map((id) => slotOf(pen, id)!);
  expect(a!.start).toBe(1000);
  expect(b!.start).toBeGreaterThanOrEqual(a!.end);
  expect(c!.start).toBeGreaterThanOrEqual(b!.end);
  expect(Math.abs(c!.end - (1000 + beatMs(LONG)))).toBeLessThan(50);
});

test("with no speak signal the next beat still draws, after a short wait for the voice (text turns)", () => {
  let pen = add(emptyPen, "c1:0", SHORT, ["p1"], 0);
  pen = add(pen, "c1:1", SHORT, ["p2"], 0);
  const first = slotOf(pen, "p1")!;
  const second = slotOf(pen, "p2")!;
  expect(second.start).toBe(first.end + VOICE.holdMs);
  expect(Number.isFinite(second.end)).toBe(true);
});

test("a speak signal starts a waiting beat right away", () => {
  let pen = add(emptyPen, "c1:0", SHORT, ["p1"], 0);
  pen = add(pen, "c1:1", SHORT, ["p2"], 0);
  const at = slotOf(pen, "p1")!.end + 100; // the pen is free, the voice starts line 2 now
  pen = penSpeak(pen, "c1:1", at, false);
  expect(slotOf(pen, "p2")!.start).toBe(at);
  expect(Math.abs(end(pen, ["p2"]) - (at + beatMs(SHORT)))).toBeLessThan(50);
});

test("pen behind the voice: the late beat's last marks hurry, and the spoken beat follows at once", () => {
  let pen = add(emptyPen, "c1:0", LONG, ["p1", "p2", "p3"], 0);
  pen = add(pen, "c1:1", SHORT, ["p4"], 0);
  const at = 1000; // line 2 starts while line 1's marks are still drawing
  expect(end(pen, ["p1", "p2", "p3"])).toBeGreaterThan(at + VOICE.catchUpMs);
  pen = penSpeak(pen, "c1:1", at, false);
  expect(end(pen, ["p1", "p2", "p3"])).toBeLessThanOrEqual(at + VOICE.catchUpMs);
  // A mark already under way keeps its start: the pen never jumps backwards.
  expect(slotOf(pen, "p1")!.start).toBe(0);
  expect(slotOf(pen, "p4")!.start).toBeLessThanOrEqual(at + VOICE.catchUpMs);
  expect(slotOf(pen, "p4")!.start).toBeGreaterThanOrEqual(end(pen, ["p1", "p2", "p3"]));
});

test("a signal for a beat already drawing changes nothing", () => {
  const pen = add(emptyPen, "c1:0", LONG, ["p1"], 0);
  expect(penSpeak(pen, "c1:0", 500, false)).toEqual({ beats: pen.beats.map((b) => ({ ...b, spoken: true })) });
  expect(penSpeak(pen, "nope:0", 500, false).beats).toEqual(pen.beats);
});

test("a beat of a later call while the pen rests starts at once", () => {
  let pen = add(emptyPen, "c1:0", SHORT, ["p1"], 0);
  pen = add(pen, "c2:0", SHORT, ["p2"], 60_000);
  expect(slotOf(pen, "p2")!.start).toBe(60_000);
});

test("an interruption stops the pen: spoken marks finish now, unspoken beats not yet drawn are dropped", () => {
  let pen = add(emptyPen, "c1:0", LONG, ["p1", "p2"], 0);
  pen = add(pen, "c1:1", SHORT, ["p3"], 0);
  pen = penSpeak(pen, "c1:0", 0, false);
  const { pen: after, dropped } = penInterrupt(pen, 800);
  expect(dropped).toEqual(["p3"]);
  expect(end(after, ["p1", "p2"])).toBe(800);
  expect(slotOf(after, "p3")).toBeUndefined();
});

test("with reduced motion every mark is drawn the moment its beat arrives", () => {
  let pen = add(emptyPen, "c1:0", LONG, ["p1", "p2"], 100, true);
  pen = add(pen, "c1:1", LONG, ["p3"], 100, true);
  for (const id of ["p1", "p2", "p3"]) expect(slotOf(pen, id)).toEqual({ start: 100, end: 100 });
});
