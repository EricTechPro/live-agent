// The circle gesture's look (ticket 43): a smoothed mint stroke with a dark edge, the listening
// pill riding the pointer, and where the ghost orb and its bubble land after the answer. Pure.
import { expect, test } from "bun:test";
import { INK, ghostPlace, loopCentre, pillRect, smooth } from "../app/src/ink-stroke.ts";

test("the stroke is mint over a 1 pt darker teal edge, no glow", () => {
  expect(INK).toMatchObject({ core: "#6ff0dc", edge: "#1f9f90", width: 4.5, glow: 0, fadeMs: 500 });
  expect(INK.edgeWidth - INK.width).toBe(2); // 1 pt each side
});

test("Chaikin smoothing keeps the ends, cuts the corners, and leaves short strokes alone", () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  const out = smooth(square, 1);
  expect(out[0]).toEqual({ x: 0, y: 0 });
  expect(out.at(-1)).toEqual({ x: 10, y: 10 });
  // The sharp corner at (10, 0) is gone: no point sits on it any more.
  expect(out.some((p) => p.x === 10 && p.y === 0)).toBe(false);
  expect(out.length).toBe(2 * (square.length - 1) + 2);
  expect(smooth([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toEqual([{ x: 1, y: 1 }, { x: 2, y: 2 }]);
});

test("the listening pill sits about 8 pt up and right of the pointer tip", () => {
  const r = pillRect({ x: 100, y: 200 });
  expect(r.x).toBe(108);
  expect(r.y + r.h).toBe(192);
  expect(r).toMatchObject({ w: 36, h: 14 });
});

test("the ghost orb lands on the circle's centre; its bubble goes right, or left near the right edge", () => {
  const loop = Array.from({ length: 12 }, (_, k) => ({ x: 300 + 50 * Math.cos((k / 12) * 2 * Math.PI), y: 200 + 40 * Math.sin((k / 12) * 2 * Math.PI) }));
  const c = loopCentre(loop);
  expect(c.x).toBeCloseTo(300, 0);
  expect(c.y).toBeCloseTo(200, 0);
  const right = ghostPlace(c, { width: 1440, height: 900 }, 320);
  expect(right.side).toBe("right");
  expect(right.bubble.x).toBeGreaterThan(c.x);
  const left = ghostPlace({ x: 1300, y: 200 }, { width: 1440, height: 900 }, 320);
  expect(left.side).toBe("left");
  expect(left.bubble.x + 320).toBeLessThan(1300);
});
