// The wave inside the orb (ticket 38): it moves only when something really happens.
import { expect, test } from "bun:test";
import { QUIET, waveFor } from "../app/src/orb-wave.ts";

test("at rest, call ended, starting and offline: a flat line", () => {
  for (const look of ["idle", "ended", "starting", "offline"] as const) {
    for (const t of [0, 1.3, 7]) expect(waveFor({ look, t, mic: 0.9 })).toEqual({ kind: "flat", amp: 0, dim: false });
  }
});

test("muted: flat and dimmed, whatever the mic hears", () => {
  expect(waveFor({ look: "muted", t: 2, mic: 1 })).toEqual({ kind: "flat", amp: 0, dim: true });
});

test("listening: the wave follows your mic level, flat when you are quiet", () => {
  expect(waveFor({ look: "listening", t: 1, mic: 0 }).kind).toBe("flat");
  expect(waveFor({ look: "listening", t: 1, mic: QUIET / 2 }).kind).toBe("flat");
  const soft = waveFor({ look: "listening", t: 1, mic: 0.3 });
  const loud = waveFor({ look: "listening", t: 1, mic: 0.9 });
  expect(soft.kind).toBe("wave");
  expect(loud.amp).toBeGreaterThan(soft.amp);
  expect(waveFor({ look: "listening", t: 1, mic: 4 }).amp).toBe(1);
});

test("speaking: the wave follows Jett's voice when its level is known", () => {
  expect(waveFor({ look: "speaking", t: 1, voice: 0 }).kind).toBe("flat");
  expect(waveFor({ look: "speaking", t: 1, voice: 0.7 })).toEqual({ kind: "wave", amp: 0.7, dim: false });
});

test("speaking with no output level: a gentle speech-like motion that changes over time", () => {
  const waves = [0, 0.4, 0.8, 1.2, 1.6].map((t) => waveFor({ look: "speaking", t }));
  for (const w of waves) {
    expect(w.kind).toBe("wave");
    expect(w.amp).toBeGreaterThan(0.2);
    expect(w.amp).toBeLessThanOrEqual(0.7);
  }
  expect(new Set(waves.map((w) => w.amp.toFixed(3))).size).toBeGreaterThan(1);
});

test("thinking and connecting: a slow sweeping dot, not the speech wave", () => {
  for (const look of ["thinking", "joining"] as const) {
    const a = waveFor({ look, t: 0.5 });
    const b = waveFor({ look, t: 1.5 });
    expect(a.kind).toBe("sweep");
    expect(a.amp).toBe(0);
    expect(a.sweep).not.toBe(b.sweep);
    expect(Math.abs(a.sweep!)).toBeLessThanOrEqual(1);
  }
});

test("reduced motion: nothing moves over time", () => {
  expect(waveFor({ look: "thinking", t: 0.5, still: true })).toEqual(waveFor({ look: "thinking", t: 9, still: true }));
  expect(waveFor({ look: "speaking", t: 0.5, still: true })).toEqual(waveFor({ look: "speaking", t: 9, still: true }));
});
