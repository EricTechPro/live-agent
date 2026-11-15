// The edge pill (ticket 39): minimised Jett is a slim capsule docked flush to a side edge.
import { expect, test } from "bun:test";
import {
  BARS, BAR_MIN, defaultPill, dockPill, hoverPill, migrateDot, morph, MORPH_MS, parsePill, PILL, PILL_INSET, PILL_MARGIN, pillActions, pillAt,
  pillBars, pillFlyout, pillForOrb, placePill,
} from "../app/src/pill.ts";
import { waveFor } from "../app/src/orb-wave.ts";

const view = { width: 1440, height: 900 };
const rightX = 1440 - PILL.width - PILL_INSET;

test("the pill is slim and tall", () => {
  expect(PILL.width).toBeLessThanOrEqual(30);
  expect(PILL.height).toBeGreaterThanOrEqual(100);
});

test("first minimise: the right edge, centre 35% from the top (clear of another app's pill at the middle)", () => {
  const spot = defaultPill(view);
  expect(spot).toEqual({ side: "right", y: Math.round(900 * 0.35 - PILL.height / 2) });
  expect(pillAt(spot, view)).toEqual({ x: rightX, y: spot.y });
});

test("dropped, it re-docks flush to the nearer side edge", () => {
  expect(dockPill({ x: 900, y: 300 }, view)).toEqual({ side: "right", y: 300 });
  expect(dockPill({ x: 400, y: 300 }, view)).toEqual({ side: "left", y: 300 });
  expect(pillAt({ side: "left", y: 300 }, view)).toEqual({ x: PILL_INSET, y: 300 });
  expect(pillAt({ side: "right", y: 300 }, view)).toEqual({ x: rightX, y: 300 });
});

test("it is kept on screen top to bottom", () => {
  expect(dockPill({ x: 1400, y: -50 }, view).y).toBe(PILL_MARGIN);
  expect(dockPill({ x: 1400, y: 5000 }, view).y).toBe(900 - PILL.height - PILL_MARGIN);
  // A saved spot from a taller screen is pulled back on.
  expect(pillAt({ side: "right", y: 2000 }, view).y).toBe(900 - PILL.height - PILL_MARGIN);
});

test("the remembered ticket-38 dot moves over: nearest side edge, level with the dot", () => {
  const dot = { width: 20, height: 20 };
  expect(migrateDot({ x: 1416, y: 590 }, dot, view)).toEqual({ side: "right", y: 600 - PILL.height / 2 });
  expect(migrateDot({ x: 4, y: 300 }, dot, view)).toEqual({ side: "left", y: 310 - PILL.height / 2 });
  // A dot on the top edge goes to the nearer side, kept on screen.
  expect(migrateDot({ x: 1000, y: 4 }, dot, view)).toEqual({ side: "right", y: PILL_MARGIN });
});

test("minimising: level with where the orb was, on its nearer side edge, kept on screen", () => {
  const orb = { x: 1200, y: 500, width: 148, height: 200 };
  expect(pillForOrb(orb, view)).toEqual({ side: "right", y: 600 - PILL.height / 2 });
  expect(pillForOrb({ ...orb, x: 60 }, view).side).toBe("left");
  expect(pillForOrb({ ...orb, y: 780 }, view).y).toBe(900 - PILL.height - PILL_MARGIN);
});

test("placing: a dragged pill's spot first, else a dragged ticket-38 dot, else level with the orb", () => {
  const dot = { width: 20, height: 20 };
  const orb = { x: 1200, y: 500, width: 148, height: 200 };
  expect(placePill({ side: "left", y: 200 }, { x: 1416, y: 590 }, dot, orb, view)).toEqual({ side: "left", y: 200 });
  expect(placePill(undefined, { x: 1416, y: 300 }, dot, orb, view)).toEqual(migrateDot({ x: 1416, y: 300 }, dot, view));
  expect(placePill(undefined, undefined, dot, orb, view)).toEqual(pillForOrb(orb, view));
});

test("the saved spot parses, junk is ignored", () => {
  expect(parsePill('{"side":"left","y":240}')).toEqual({ side: "left", y: 240 });
  expect(parsePill('{"side":"top","y":240}')).toBeUndefined();
  expect(parsePill('{"side":"right"}')).toBeUndefined();
  expect(parsePill("nope")).toBeUndefined();
  expect(parsePill(null)).toBeUndefined();
});

const bars = (look: Parameters<typeof waveFor>[0]["look"], o: { mic?: number; voice?: number; t?: number; still?: boolean } = {}) =>
  pillBars(waveFor({ look, t: o.t ?? 1, mic: o.mic, voice: o.voice, still: o.still }), o.t ?? 1, o.still);

test("the bars are flat at rest, ended, offline and while muted", () => {
  for (const look of ["idle", "ended", "offline", "starting", "muted"] as const) {
    expect(bars(look, { mic: 0.9 })).toEqual(Array(BARS).fill(BAR_MIN));
  }
});

test("listening: the bars follow the mic level, flat while quiet", () => {
  expect(bars("listening", { mic: 0 })).toEqual(Array(BARS).fill(BAR_MIN));
  const loud = bars("listening", { mic: 0.9 });
  const soft = bars("listening", { mic: 0.3 });
  expect(Math.max(...loud)).toBeGreaterThan(Math.max(...soft));
  expect(Math.max(...soft)).toBeGreaterThan(BAR_MIN);
  for (const h of loud) expect(h).toBeLessThanOrEqual(1);
});

test("speaking: the bars follow Jett's level", () => {
  expect(Math.max(...bars("speaking", { voice: 0.8 }))).toBeGreaterThan(BAR_MIN);
  expect(bars("speaking", { voice: 0 })).toEqual(Array(BARS).fill(BAR_MIN));
});

test("thinking: one bar lifts and the lift sweeps along", () => {
  const a = bars("thinking", { t: 0 });
  const b = bars("thinking", { t: 1 });
  expect(a).not.toEqual(b);
  expect(Math.max(...a)).toBeGreaterThan(BAR_MIN);
});

test("reduced motion: nothing moves over time", () => {
  expect(bars("listening", { mic: 0.8, t: 1, still: true })).toEqual(bars("listening", { mic: 0.8, t: 2.3, still: true }));
  expect(bars("thinking", { t: 1, still: true })).toEqual(bars("thinking", { t: 2.3, still: true }));
  expect(bars("speaking", { t: 1, still: true })).toEqual(bars("speaking", { t: 2.3, still: true }));
});

test("quick actions: expand, then the call buttons (start, or mute / unmute and hang up)", () => {
  expect(pillActions(["start"])).toEqual(["expand", "start"]);
  expect(pillActions(["mute", "hangup"])).toEqual(["expand", "mute", "hangup"]);
  expect(pillActions(["unmute", "hangup"])).toEqual(["expand", "unmute", "hangup"]);
  expect(pillActions([])).toEqual(["expand"]);
});

test("the actions sit beside the pill, on the side away from the edge, centred on it", () => {
  const right = { x: rightX, y: 300, width: PILL.width, height: PILL.height };
  const fr = pillFlyout(right, "right", 3);
  expect(fr.x + fr.width).toBeLessThan(right.x);
  expect(fr.y + fr.height / 2).toBeCloseTo(right.y + right.height / 2, 0);
  const left = { x: PILL_INSET, y: 300, width: PILL.width, height: PILL.height };
  expect(pillFlyout(left, "left", 3).x).toBeGreaterThan(left.x + left.width);
  expect(pillFlyout(right, "right", 3).height).toBeGreaterThan(pillFlyout(right, "right", 2).height);
});

test("hover: over the pill opens it; once open, moving onto the actions keeps it open", () => {
  const rect = { x: rightX, y: 300, width: PILL.width, height: PILL.height };
  const fly = pillFlyout(rect, "right", 3);
  const onActions = { x: fly.x + fly.width / 2, y: fly.y + fly.height / 2 };
  expect(hoverPill({ x: rect.x + 10, y: 350 }, rect, "right", false, 3)).toBe(true);
  expect(hoverPill(onActions, rect, "right", false, 3)).toBe(false);
  expect(hoverPill(onActions, rect, "right", true, 3)).toBe(true);
  expect(hoverPill({ x: 400, y: 350 }, rect, "right", true, 3)).toBe(false);
  expect(hoverPill(undefined, rect, "right", true, 3)).toBe(false);
});

test("the morph: shrink and slide from the orb onto the pill, in about 200 ms (none with reduced motion)", () => {
  const orb = { x: 1200, y: 600, width: 148, height: 200 };
  const pill = { x: rightX, y: 260, width: PILL.width, height: PILL.height };
  const m = morph(orb, pill);
  expect(m.x).toBe(pill.x - orb.x);
  expect(m.y).toBe(pill.y - orb.y);
  expect(m.sx).toBeCloseTo(PILL.width / 148);
  expect(m.sy).toBeCloseTo(PILL.height / 200);
  expect(MORPH_MS(false)).toBeGreaterThanOrEqual(150);
  expect(MORPH_MS(false)).toBeLessThanOrEqual(250);
  expect(MORPH_MS(true)).toBe(0);
});
