// The dot-matrix look (ticket 42): luminance -> 5-level teal ramp through an ordered (Bayer 4x4)
// dither, dark cells dropped; the reveal goes from sparse dots to full. Pure, no canvas.
import { expect, test } from "bun:test";
import { BAYER4, RAMP, ditherCells, levelAt, reveal } from "../app/src/dither.ts";

test("the ramp is five teal levels from the app's tokens, dark to near white", () => {
  expect(RAMP).toEqual(["#1d4a48", "#2f7c74", "#4fbfa9", "#78ffe2", "#e8fffa"]);
});

test("the Bayer matrix holds 0..15 once each", () => {
  expect([...BAYER4].map(Number).sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i));
});

test("black is dropped (level 0), white is the top level, mid grey dithers between two levels", () => {
  expect(levelAt(0, 0, 0)).toBe(0);
  expect(levelAt(1, 3, 3)).toBe(5);
  const mids = new Set<number>();
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) mids.add(levelAt(0.5, x, y));
  expect([...mids].sort()).toEqual([2, 3]);
});

test("ditherCells keeps only lit cells, with their grid position and level", () => {
  const lum = Float32Array.from([0, 1, 0.02, 0.9]);
  const cells = ditherCells(lum, 2, 2);
  expect(cells.map((c) => [c.x, c.y])).toEqual([[1, 0], [1, 1]]);
  expect(cells.every((c) => c.level >= 1 && c.level <= 5)).toBe(true);
});

test("reveal: about a quarter of the dots first with no glow, then all of them with the glow", () => {
  expect(reveal(0)).toEqual({ density: 0.25, glow: 0 });
  expect(reveal(1)).toEqual({ density: 1, glow: 1 });
  const mid = reveal(0.6);
  expect(mid.density).toBeGreaterThan(0.25);
  expect(mid.density).toBeLessThan(1);
});

test("photo luminance: stretched to the full range, and a light background is flipped so it drops out", async () => {
  const { photoLum } = await import("../app/src/dither.ts");
  // 3 x 3 RGBA: white border round one dark middle pixel (a diagram on white paper).
  const px = new Uint8ClampedArray(9 * 4).fill(255);
  px.set([20, 20, 20, 255], 4 * 4);
  const lum = photoLum(px, 3, 3);
  expect(lum[0]).toBeCloseTo(0, 5); // the white paper drops out
  expect(lum[4]).toBeCloseTo(1, 5); // the dark thing lights up
  // A dark photo (a black hole on black) keeps its sense.
  const dark = new Uint8ClampedArray(9 * 4).fill(0);
  for (let i = 3; i < dark.length; i += 4) dark[i] = 255;
  dark.set([200, 200, 200, 255], 4 * 4);
  const lum2 = photoLum(dark, 3, 3);
  expect(lum2[0]).toBeCloseTo(0, 5);
  expect(lum2[4]).toBeCloseTo(1, 5);
});
