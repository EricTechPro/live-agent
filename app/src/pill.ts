// The edge pill (ticket 39): minimised Jett is a slim vertical capsule docked flush to the
// left or right screen edge. Pure: sizes, points and levels in, spots, bars and yes/no out.
// All values are CSS pixels inside the overlay.
//
// - First minimise: the right edge, its centre 35% from the top (another app's pill often
//   sits at the vertical centre of the same edge).
// - Dragged, it moves freely; dropped, it re-docks to the nearer side edge.
// - Inside: a state dot, five mini level bars, an expand chevron.
// - Under the cursor it widens and shows quick actions beside it, away from the edge.
import type { CallButton } from "./call-state.ts";
import type { Wave } from "./orb-wave.ts";
import { hit, type Point, type Rect, type Size } from "./overlay.ts";

export type Side = "left" | "right";
/** Where the pill is docked: the side edge, and its top (CSS px). */
export interface PillSpot {
  side: Side;
  y: number;
}

/** The capsule at rest. Hovered it widens a little (CSS only; the spot is the same). */
export const PILL: Size = { width: 28, height: 112 };
/** Gap between the pill and the screen edge: flush, with a hair so its shadow shows. */
export const PILL_INSET = 2;
/** The pill keeps this far from the top and bottom of the screen. */
export const PILL_MARGIN = 12;
/** First minimise: the pill's centre sits this far down the screen. */
export const PILL_TOP = 0.35;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));
const keepY = (y: number, view: Size) => Math.round(clamp(y, PILL_MARGIN, Math.max(PILL_MARGIN, view.height - PILL.height - PILL_MARGIN)));

/** The first-minimise spot: right edge, centre 35% from the top. */
export function defaultPill(view: Size): PillSpot {
  return { side: "right", y: keepY(view.height * PILL_TOP - PILL.height / 2, view) };
}

/** Dropped with its top-left at `at`: re-dock to the nearer side edge, kept on screen. */
export function dockPill(at: Point, view: Size): PillSpot {
  const cx = at.x + PILL.width / 2;
  return { side: cx < view.width / 2 ? "left" : "right", y: keepY(at.y, view) };
}

/** The pill's top-left corner for a spot (flush to its edge, kept on this screen). */
export function pillAt(spot: PillSpot, view: Size): Point {
  return { x: spot.side === "left" ? PILL_INSET : view.width - PILL.width - PILL_INSET, y: keepY(spot.y, view) };
}

/** A ticket-38 dot spot moves over: the nearer side edge, the pill level with the dot. */
export function migrateDot(dot: Point, dotSize: Size, view: Size): PillSpot {
  const c = { x: dot.x + dotSize.width / 2, y: dot.y + dotSize.height / 2 };
  return dockPill({ x: c.x - PILL.width / 2, y: c.y - PILL.height / 2 }, view);
}

/** Where the pill goes: its saved spot, else the old dot's spot moved over, else the default. */
export function placePill(saved: PillSpot | undefined, oldDot: Point | undefined, dotSize: Size, view: Size): PillSpot {
  if (saved) return { side: saved.side, y: keepY(saved.y, view) };
  if (oldDot) return migrateDot(oldDot, dotSize, view);
  return defaultPill(view);
}

/** The saved spot (JSON in localStorage), or undefined for nothing or junk. */
export function parsePill(raw: string | null): PillSpot | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as Partial<PillSpot>;
    return (v.side === "left" || v.side === "right") && Number.isFinite(v.y) ? { side: v.side, y: v.y! } : undefined;
  } catch {
    return undefined;
  }
}

// ---- the mini level bars --------------------------------------------------------------
export const BARS = 5;
/** A flat bar: a short tick, so the meter reads as "here, quiet". */
export const BAR_MIN = 0.16;
/** The meter's shape: tallest in the middle. */
const SHAPE = [0.55, 0.8, 1, 0.8, 0.55];

/**
 * The bars, 0..1 each, from the orb's wave (orb-wave.ts): flat stays flat, a wave lifts
 * the bars by its height with a little shimmer, a sweep lifts one bar and moves it along.
 * With `still` nothing changes over time.
 */
export function pillBars(wave: Wave, t: number, still = false, n = BARS): number[] {
  const out = (f: (i: number) => number) => Array.from({ length: n }, (_, i) => Math.round(clamp(f(i), BAR_MIN, 1) * 1000) / 1000);
  if (wave.kind === "flat") return Array(n).fill(BAR_MIN);
  if (wave.kind === "sweep") {
    const pos = (((wave.sweep ?? 0) + 1) / 2) * (n - 1);
    return out((i) => BAR_MIN + 0.45 * Math.max(0, 1 - Math.abs(pos - i)));
  }
  return out((i) => {
    const shimmer = still ? 1 : 0.7 + 0.3 * Math.abs(Math.sin(t * 9 + i * 1.9));
    return BAR_MIN + (1 - BAR_MIN) * wave.amp * (SHAPE[i % SHAPE.length] ?? 1) * shimmer;
  });
}

// ---- hover: quick actions beside the pill ------------------------------------------------
export type PillAction = "expand" | CallButton;

/** The quick actions, top to bottom: expand, then the call's own buttons. */
export function pillActions(buttons: readonly CallButton[]): PillAction[] {
  return ["expand", ...buttons];
}

/** Quick-action button size, gap between them, the column's padding, and its gap to the pill. */
export const ACTION = { size: 28, gap: 4, pad: 4, off: 8 };

/** The quick-actions column: beside the pill on the side away from the edge, centred on it. */
export function pillFlyout(pill: Rect, side: Side, count: number): Rect {
  const width = ACTION.size + ACTION.pad * 2;
  const height = count * ACTION.size + Math.max(0, count - 1) * ACTION.gap + ACTION.pad * 2;
  const x = side === "right" ? pill.x - ACTION.off - width : pill.x + pill.width + ACTION.off;
  return { x, y: Math.round(pill.y + pill.height / 2 - height / 2), width, height };
}

/** Padding around the pill (and its open actions) in which the cursor counts as over it. */
export const PILL_HOVER_PAD = 8;

/**
 * Is the cursor over the pill? Closed: the pill plus padding. Open: also the actions
 * column and the gap to it, so moving onto an action keeps them open. From the overlay
 * poll's cursor, not DOM hover (none arrives while another app is in front).
 */
export function hoverPill(point: Point | undefined, pill: Rect, side: Side, open: boolean, count: number): boolean {
  if (!point) return false;
  if (!open) return hit(point, [pill], PILL_HOVER_PAD);
  const f = pillFlyout(pill, side, count);
  const x = Math.min(pill.x, f.x);
  const y = Math.min(pill.y, f.y);
  const zone = { x, y, width: Math.max(pill.x + pill.width, f.x + f.width) - x, height: Math.max(pill.y + pill.height, f.y + f.height) - y };
  return hit(point, [zone], PILL_HOVER_PAD);
}

// ---- orb <-> pill animation -----------------------------------------------------------
/** The move and scale that lay `from` over `to` (top-left origin): the orb shrinking onto the pill. */
export function morph(from: Rect, to: Rect): { x: number; y: number; sx: number; sy: number } {
  return { x: to.x - from.x, y: to.y - from.y, sx: to.width / from.width, sy: to.height / from.height };
}

/** How long orb <-> pill takes: about 200 ms, none with prefers-reduced-motion. */
export const MORPH_MS = (reduced: boolean) => (reduced ? 0 : 200);
