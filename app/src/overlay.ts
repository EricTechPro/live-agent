// The full-screen overlay's geometry (ticket 36). Pure: sizes and points in, positions
// and yes/no out. All values are CSS pixels inside the overlay (the main screen).
//
// - The orb floats where you drag it, kept on screen; it remembers the spot. First
//   launch: bottom right.
// - The popover opens beside the orb, on the side with room.
// - Click-through: the window ignores the mouse except over the interactive bits. The
//   window polls the cursor and asks `capture` whether to take the mouse right now.

export interface Size {
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}
export type Rect = Point & Size;

/** Gap kept between the orb (or popover) and the screen edge. */
export const EDGE = 16;
/** Where the orb starts on first launch, from the bottom-right corner (clear of the Dock and the captions). */
export const START_INSET = { right: 40, bottom: 120 };
/** Extra margin around each interactive rectangle, so the edge of a button never flickers to click-through. */
export const HIT_PAD = 6;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/** A top-left corner that keeps `size` on screen. */
export function keepOn(at: Point, size: Size, view: Size): Point {
  return {
    x: Math.round(clamp(at.x, EDGE, Math.max(EDGE, view.width - size.width - EDGE))),
    y: Math.round(clamp(at.y, EDGE, Math.max(EDGE, view.height - size.height - EDGE))),
  };
}

/** Where the orb goes: the saved spot (kept on screen), or the first-launch corner. */
export function placeOrb(saved: Point | undefined, size: Size, view: Size): Point {
  if (saved) return keepOn(saved, size, view);
  return keepOn({ x: view.width - size.width - START_INSET.right, y: view.height - size.height - START_INSET.bottom }, size, view);
}

/** Dragging by the grip: the orb moves with the pointer, kept on screen. */
export function dragTo(start: Point, from: Point, now: Point, size: Size, view: Size): Point {
  return keepOn({ x: start.x + now.x - from.x, y: start.y + now.y - from.y }, size, view);
}

/**
 * The popover beside the orb: on the side with more room (left of an orb on the right
 * half), bottoms lined up, kept on screen. With no room on either side it overlaps.
 */
export function placePopover(orb: Rect, pop: Size, view: Size, gap = 12): Point {
  const leftX = orb.x - gap - pop.width;
  const rightX = orb.x + orb.width + gap;
  const preferLeft = orb.x + orb.width / 2 > view.width / 2;
  const fitsLeft = leftX >= EDGE;
  const fitsRight = rightX + pop.width <= view.width - EDGE;
  const x = preferLeft ? (fitsLeft || !fitsRight ? leftX : rightX) : fitsRight || !fitsLeft ? rightX : leftX;
  return keepOn({ x, y: orb.y + orb.height - pop.height }, pop, view);
}

/** Is the point over (or within HIT_PAD of) any of the rectangles? */
export function hit(point: Point, rects: readonly Rect[], pad = HIT_PAD): boolean {
  return rects.some((r) => point.x >= r.x - pad && point.x <= r.x + r.width + pad && point.y >= r.y - pad && point.y <= r.y + r.height + pad);
}

export interface CaptureInputs {
  /** The cursor inside the overlay, or undefined when it is off this screen. */
  point: Point | undefined;
  /** The interactive bits on screen now: the orb and its buttons, the popover, approval cards, the canvas X. */
  rects: readonly Rect[];
  /** Something must keep the mouse whatever the pointer does: a drag in progress, the setup wizard. */
  hold: boolean;
}

/** Should the window take the mouse now (true), or let clicks through to the apps below (false)? */
export function capture({ point, rects, hold }: CaptureInputs): boolean {
  if (hold) return true;
  return point !== undefined && hit(point, rects);
}

/** The saved orb position (JSON in localStorage), or undefined for nothing or junk. */
export function parseSaved(raw: string | null): Point | undefined {
  if (!raw) return undefined;
  try {
    const v = JSON.parse(raw) as Partial<Point>;
    return Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x!, y: v.y! } : undefined;
  } catch {
    return undefined;
  }
}

// ---- follow the pointer (optional, ticket 37) ------------------------------------
/** Closer than this to the orb's centre, the orb holds still so you can click it. */
export const NEAR = 200;
/** Where the orb trails the pointer: below right of it. */
export const TRAIL = { x: 36, y: 28 };

/**
 * One step of following the pointer (Roamies' default; ours is off unless chosen):
 * the orb eases toward a spot just below right of the pointer, and holds still once
 * the pointer comes near it, so you can reach it.
 */
export function followStep(at: Point, size: Size, pointer: Point | undefined, view: Size, ease = 0.18): Point {
  if (!pointer) return at;
  const centre = { x: at.x + size.width / 2, y: at.y + size.height / 2 };
  if (Math.hypot(pointer.x - centre.x, pointer.y - centre.y) < NEAR) return at;
  const target = keepOn({ x: pointer.x + TRAIL.x, y: pointer.y + TRAIL.y }, size, view);
  return keepOn({ x: at.x + (target.x - at.x) * ease, y: at.y + (target.y - at.y) * ease }, size, view);
}

// ---- the drawing card (ticket 36) -------------------------------------------------
/** The drawing goes in the empty half of the screen: away from the orb, near the top. */
export function placeCard(orb: Rect, card: Size, view: Size): Point {
  const orbOnRight = orb.x + orb.width / 2 > view.width / 2;
  const free = orbOnRight ? { x: EDGE, w: orb.x - EDGE * 2 } : { x: orb.x + orb.width + EDGE, w: view.width - orb.x - orb.width - EDGE * 2 };
  // Centred in the free side when it fits, else centred on the screen.
  const x = free.w >= card.width ? free.x + (free.w - card.width) / 2 : (view.width - card.width) / 2;
  return keepOn({ x, y: Math.max(EDGE, view.height * 0.08) }, card, view);
}

// ---- push to talk (ticket 37): hold Ctrl+Option, let go to send --------------------
/** Held this long before it counts, so Ctrl+Option+S (show / hide) never starts talking. */
export const HOLD_MS = 250;
/** After you let go the mic stays open this long, so Gemini hears the end of your sentence and the quiet after it. */
export const TAIL_MS = 1200;

export interface Ptt {
  /** When the keys went down (still held), or undefined. */
  downAt?: number;
  /** Talking started on this hold. */
  talking: boolean;
  /** When the keys came up after talking; the mic closes TAIL_MS later. */
  upAt?: number;
}
export const pttIdle: Ptt = { talking: false };

/** Feed the keys' state each poll. `act`: "talk" opens the mic (starting a call if needed), "release" closes it again. */
export function pttStep(p: Ptt, held: boolean, now: number): { ptt: Ptt; act?: "talk" | "release" } {
  if (held) {
    if (p.downAt === undefined) return { ptt: { downAt: now, talking: p.talking && p.upAt !== undefined } };
    if (!p.talking && now - p.downAt >= HOLD_MS) return { ptt: { downAt: p.downAt, talking: true }, act: "talk" };
    if (p.talking && p.upAt !== undefined) return { ptt: { downAt: p.downAt, talking: true } };
    return { ptt: p };
  }
  if (p.downAt !== undefined) return { ptt: p.talking ? { talking: true, upAt: now } : pttIdle };
  if (p.talking && p.upAt !== undefined && now - p.upAt >= TAIL_MS) return { ptt: pttIdle, act: "release" };
  return { ptt: p };
}
