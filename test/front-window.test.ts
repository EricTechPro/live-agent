// The front window as card obstacles (app/src/layout.ts frontWindowObstacles): a window with room beside it is
// avoided whole; one that fills the screen keeps only its top band (tabs, address and bookmarks
// bars) hard and its words and controls soft.
import { expect, test } from "bun:test";
import { CHROME_BAND, frontWindowObstacles as frontWindowAvoid } from "../app/src/layout.ts";

const view = { width: 1440, height: 900 };

test("a window with room beside it is a hard obstacle", () => {
  const win = { x: 700, y: 40, w: 700, h: 800 };
  expect(frontWindowAvoid(win, view)).toEqual({ hard: [win], soft: [] });
});

test("a full-screen window: only its chrome band is hard", () => {
  const win = { x: 0, y: 0, w: 1440, h: 880 };
  expect(frontWindowAvoid(win, view).hard).toEqual([{ x: 0, y: 0, w: 1440, h: CHROME_BAND }]);
});

test("no window: nothing to avoid", () => {
  expect(frontWindowAvoid(undefined, view)).toEqual({ hard: [], soft: [] });
});

test("a full-screen window's words and controls are soft obstacles", () => {
  const busy = [{ x: 10, y: 200, w: 100, h: 14 }];
  expect(frontWindowAvoid({ x: 0, y: 0, w: 1440, h: 880 }, view, busy).soft).toEqual(busy);
});
