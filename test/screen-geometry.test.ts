// Screen geometry: pixel -> point mapping (Retina), closed-loop detection, the ink crop.
import { describe, expect, test } from "bun:test";
import {
  circleSentence, findLoop, fitLongSide, inkCrop, pixelRectToPoints, pixelToPoint, pointToPixel, spotName,
  type Pt, type ShotMap,
} from "../src/screen/geometry.ts";

const arc = (cx: number, cy: number, r: number, fromDeg: number, toDeg: number, steps = 40): Pt[] =>
  Array.from({ length: steps + 1 }, (_, k) => {
    const a = ((fromDeg + ((toDeg - fromDeg) * k) / steps) * Math.PI) / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  });

describe("pixel -> point mapping", () => {
  test("a Retina screen shrunk to 1568 px maps back to points", () => {
    // 1512 x 982 pt screen, 2x Retina (3024 px), shot shrunk to 1568 px wide.
    const px = fitLongSide(3024, 1964);
    expect(px).toEqual({ w: 1568, h: 1018 });
    const map: ShotMap = { origin: { x: 0, y: 0 }, size: { w: 1512, h: 982 }, px };
    expect(pixelToPoint(map, { x: 1568, y: 1018 })).toEqual({ x: 1512, y: 982 });
    expect(pixelToPoint(map, { x: 784, y: 509 })).toEqual({ x: 756, y: 491 });
  });

  test("a crop's origin is added, and the box scales too", () => {
    const map: ShotMap = { origin: { x: 400, y: 300 }, size: { w: 320, h: 220 }, px: { w: 640, h: 440 } };
    expect(pixelRectToPoints(map, { x: 100, y: 40, w: 60, h: 20 })).toEqual({ x: 450, y: 320, w: 30, h: 10 });
    expect(pointToPixel(map, { x: 450, y: 320 })).toEqual({ x: 100, y: 40 });
  });

  test("never upscales a small shot", () => {
    expect(fitLongSide(640, 440)).toEqual({ w: 640, h: 440 });
  });
});

describe("closed loops", () => {
  test("a full circle is a loop", () => {
    expect(findLoop(arc(500, 400, 60, 0, 360))).not.toBeNull();
  });

  test("a three-quarter circle is not", () => {
    expect(findLoop(arc(500, 400, 60, 0, 270))).toBeNull();
  });

  test("a run-up and an overshoot still count", () => {
    const runUp = Array.from({ length: 10 }, (_, k) => ({ x: 300 + k * 20, y: 500 - k * 10 }));
    const loop = arc(560, 400, 60, 0, 400);
    const overshoot = Array.from({ length: 6 }, (_, k) => ({ x: 610 + k * 15, y: 440 + k * 12 }));
    const found = findLoop([...runUp, ...loop, ...overshoot]);
    expect(found).not.toBeNull();
    // The loop itself, not the run-up: its box sits around the circle.
    const xs = found!.map((p) => p.x);
    expect(Math.min(...xs)).toBeGreaterThan(480);
  });

  test("a straight line and a back-and-forth scribble are not", () => {
    const line = Array.from({ length: 30 }, (_, k) => ({ x: 100 + k * 10, y: 100 }));
    expect(findLoop(line)).toBeNull();
    const scribble: Pt[] = [];
    // Back and forth across, drifting down a little each pass.
    for (let k = 0; k < 6; k++) for (let s = 0; s <= 8; s++) scribble.push({ x: 100 + (k % 2 ? 8 - s : s) * 20, y: 200 + k * 8 + s });
    expect(findLoop(scribble)).toBeNull();
  });

  test("a tiny loop (a twitch) is not", () => {
    expect(findLoop(arc(100, 100, 5, 0, 360))).toBeNull();
  });
});

describe("ink crop", () => {
  const screen = { x: 0, y: 0, w: 1512, h: 982 };

  test("pads the loop and grows it to at least 320 x 220", () => {
    expect(inkCrop(arc(700, 500, 20, 0, 360), screen)).toEqual({ x: 540, y: 390, w: 320, h: 220 });
  });

  test("a big loop gets 48 pt of padding each side", () => {
    expect(inkCrop(arc(700, 500, 200, 0, 360), screen)).toEqual({ x: 452, y: 252, w: 496, h: 496 });
  });

  test("stays on the screen near a corner", () => {
    const crop = inkCrop(arc(10, 10, 8, 0, 360), screen);
    expect(crop).toEqual({ x: 0, y: 0, w: 320, h: 220 });
    const far = inkCrop(arc(1505, 975, 8, 0, 360), screen);
    expect(far.x + far.w).toBe(1512);
    expect(far.y + far.h).toBe(982);
  });
});

describe("where the circle is, in words", () => {
  const screen = { x: 0, y: 0, w: 1500, h: 900 };
  test("thirds of the screen", () => {
    expect(spotName({ x: 100, y: 100 }, screen)).toBe("top left");
    expect(spotName({ x: 750, y: 450 }, screen)).toBe("middle");
    expect(spotName({ x: 1400, y: 450 }, screen)).toBe("right");
    expect(circleSentence(arc(200, 120, 30, 0, 360), screen)).toBe("I circled something at the top left of the screen.");
  });
});
