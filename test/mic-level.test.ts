// The orb's voice level (ticket 37): silence is 0, speech lifts it, it never passes 1.
import { expect, test } from "bun:test";
import { levelOf } from "../app/src/mic-level.ts";

const tone = (amp: number) => Float32Array.from({ length: 512 }, (_, i) => amp * Math.sin(i / 5));

test("silence and room noise read as 0", () => {
  expect(levelOf(new Float32Array(512))).toBe(0);
  expect(levelOf(tone(0.005))).toBe(0);
  expect(levelOf(new Float32Array(0))).toBe(0);
});

test("louder speech reads higher, capped at 1", () => {
  const quiet = levelOf(tone(0.05));
  const loud = levelOf(tone(0.2));
  expect(quiet).toBeGreaterThan(0);
  expect(loud).toBeGreaterThan(quiet);
  expect(levelOf(tone(1))).toBe(1);
});
