// The full-screen overlay (ticket 36): where the orb and popover go, and when the
// window takes the mouse instead of letting clicks through.
import { expect, test } from "bun:test";
import {
  capture, dragTo, EDGE, followStep, hit, HIT_PAD, HOLD_MS, keepOn, NEAR, parseSaved, placeCard, placeOrb, placePopover,
  pttIdle, pttStep, START_INSET, TAIL_MS, type Ptt,
} from "../app/src/overlay.ts";

const view = { width: 1440, height: 900 };
const orb = { width: 160, height: 220 };
const pop = { width: 380, height: 520 };

test("first launch: the orb sits bottom right, clear of the edge", () => {
  expect(placeOrb(undefined, orb, view)).toEqual({ x: 1440 - 160 - START_INSET.right, y: 900 - 220 - START_INSET.bottom });
});

test("a saved spot comes back, kept on screen (a smaller screen than last time)", () => {
  expect(placeOrb({ x: 300, y: 200 }, orb, view)).toEqual({ x: 300, y: 200 });
  expect(placeOrb({ x: 2400, y: 1300 }, orb, view)).toEqual({ x: 1440 - 160 - EDGE, y: 900 - 220 - EDGE });
  expect(placeOrb({ x: -50, y: -10 }, orb, view)).toEqual({ x: EDGE, y: EDGE });
});

test("dragging moves the orb with the pointer and never off screen", () => {
  expect(dragTo({ x: 500, y: 400 }, { x: 580, y: 410 }, { x: 600, y: 300 }, orb, view)).toEqual({ x: 520, y: 290 });
  expect(dragTo({ x: 500, y: 400 }, { x: 580, y: 410 }, { x: 5000, y: 410 }, orb, view).x).toBe(1440 - 160 - EDGE);
});

test("something bigger than the screen sits at its top-left edge", () => {
  expect(keepOn({ x: 300, y: 300 }, { width: 2000, height: 2000 }, view)).toEqual({ x: EDGE, y: EDGE });
});

test("the popover opens left of an orb on the right half, bottoms lined up", () => {
  const at = { x: 1200, y: 600, ...orb };
  expect(placePopover(at, pop, view)).toEqual({ x: 1200 - 12 - 380, y: 600 + 220 - 520 });
});

test("the popover opens right of an orb on the left half", () => {
  const at = { x: 40, y: 300, ...orb };
  expect(placePopover(at, pop, view).x).toBe(40 + 160 + 12);
});

test("the popover is kept on screen near the top", () => {
  const at = { x: 1200, y: 20, ...orb };
  expect(placePopover(at, pop, view).y).toBe(EDGE);
});

test("a hit counts within a small margin around each rectangle", () => {
  const rects = [{ x: 100, y: 100, width: 50, height: 40 }];
  expect(hit({ x: 120, y: 120 }, rects)).toBe(true);
  expect(hit({ x: 100 - HIT_PAD, y: 100 }, rects)).toBe(true);
  expect(hit({ x: 100 - HIT_PAD - 1, y: 100 }, rects)).toBe(false);
  expect(hit({ x: 500, y: 500 }, rects)).toBe(false);
  expect(hit({ x: 1, y: 1 }, [])).toBe(false);
});

test("click-through everywhere except over the interactive bits", () => {
  const rects = [{ x: 1200, y: 600, ...orb }];
  expect(capture({ point: { x: 1250, y: 700 }, rects, hold: false })).toBe(true);
  expect(capture({ point: { x: 400, y: 300 }, rects, hold: false })).toBe(false);
  expect(capture({ point: undefined, rects, hold: false })).toBe(false);
});

test("a drag or the setup wizard keeps the mouse wherever the pointer goes", () => {
  expect(capture({ point: { x: 400, y: 300 }, rects: [], hold: true })).toBe(true);
  expect(capture({ point: undefined, rects: [], hold: true })).toBe(true);
});

test("following: the orb eases toward the pointer, and holds still when the pointer is near", () => {
  const at = { x: 1000, y: 600 };
  const far = followStep(at, orb, { x: 200, y: 200 }, view);
  expect(far.x).toBeLessThan(at.x);
  expect(far.y).toBeLessThan(at.y);
  const centre = { x: at.x + orb.width / 2, y: at.y + orb.height / 2 };
  expect(followStep(at, orb, { x: centre.x + NEAR - 10, y: centre.y }, view)).toEqual(at);
  expect(followStep(at, orb, undefined, view)).toEqual(at);
});

test("the drawing card goes in the empty half, away from the orb", () => {
  const card = { width: 560, height: 380 };
  const right = placeCard({ x: 1200, y: 600, ...orb }, card, view);
  expect(right.x + card.width).toBeLessThan(1200);
  const left = placeCard({ x: 40, y: 600, ...orb }, card, view);
  expect(left.x).toBeGreaterThan(40 + orb.width);
});

const feed = (steps: [boolean, number][]) => {
  let p: Ptt = pttIdle;
  const acts: string[] = [];
  for (const [held, at] of steps) {
    const r = pttStep(p, held, at);
    p = r.ptt;
    if (r.act) acts.push(r.act + "@" + at);
  }
  return acts;
};

test("push to talk: hold Ctrl+Option to talk, let go and the mic closes a moment later", () => {
  const up = 2050;
  expect(feed([[true, 0], [true, HOLD_MS], [true, 2000], [false, up], [false, up + TAIL_MS - 1], [false, up + TAIL_MS]])).toEqual([
    "talk@" + HOLD_MS,
    "release@" + (up + TAIL_MS),
  ]);
});

test("a quick tap (Ctrl+Option+S) never starts talking", () => {
  expect(feed([[true, 0], [true, 100], [false, 150], [false, 5000]])).toEqual([]);
});

test("holding again before the mic closes keeps talking, no second start", () => {
  const up = 2500;
  expect(feed([[true, 0], [true, 300], [false, 1000], [true, 1500], [true, 1900], [false, up], [false, up + TAIL_MS]])).toEqual([
    "talk@300",
    "release@" + (up + TAIL_MS),
  ]);
});

test("the saved position reads back, and junk reads as nothing", () => {
  expect(parseSaved(JSON.stringify({ x: 10, y: 20 }))).toEqual({ x: 10, y: 20 });
  expect(parseSaved(null)).toBeUndefined();
  expect(parseSaved("{")).toBeUndefined();
  expect(parseSaved(JSON.stringify({ x: "a", y: 1 }))).toBeUndefined();
});
