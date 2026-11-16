// Screen geometry: one global space in points (top-left origin, the main display at 0,0),
// the same space macOS's window list and cursor use. Pure functions, shared by the core
// and the window, so the maths is tested once.
//
//   pixel -> point:  origin + px * (points / pixels)   (Retina is absorbed here)
//   closed loop:     a stroke that comes back to itself and turns most of a full circle
//   ink crop:        the loop's box, padded, grown to a minimum, kept on the screen

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** How a screenshot's pixels sit on the screen: `origin`/`size` in points, `px` its pixel size. */
export interface ShotMap {
  origin: Pt;
  size: { w: number; h: number };
  px: { w: number; h: number };
}

/** A screenshot pixel back to a global screen point. */
export function pixelToPoint(map: ShotMap, p: Pt): Pt {
  return {
    x: map.origin.x + p.x * (map.size.w / map.px.w),
    y: map.origin.y + p.y * (map.size.h / map.px.h),
  };
}

/** A box in screenshot pixels back to global points. */
export function pixelRectToPoints(map: ShotMap, r: Rect): Rect {
  const at = pixelToPoint(map, r);
  return { x: at.x, y: at.y, w: r.w * (map.size.w / map.px.w), h: r.h * (map.size.h / map.px.h) };
}

/** A global point to screenshot pixels (to draw on a shot). */
export function pointToPixel(map: ShotMap, p: Pt): Pt {
  return {
    x: (p.x - map.origin.x) * (map.px.w / map.size.w),
    y: (p.y - map.origin.y) * (map.px.h / map.size.h),
  };
}

/** Shrink so the long side is at most `max` (never grow), keeping the aspect ratio. */
export function fitLongSide(w: number, h: number, max = 1568): { w: number; h: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * The first closed loop in a stroke, or null. A loop is a stretch that ends close to where
 * it began, is not tiny, and turns at least ~300° around its own middle. That keeps a full
 * circle (and one drawn with a run-up and an overshoot), and drops a ¾ circle (its ends are
 * far apart), a straight line and a back-and-forth scribble (it never turns around).
 */
export function findLoop(stroke: readonly Pt[], minSize = 20): Pt[] | null {
  const n = stroke.length;
  if (n < 8) return null;
  for (let j = 7; j < n; j++) {
    for (let i = 0; i <= j - 7; i++) {
      const seg = stroke.slice(i, j + 1);
      const box = bounds(seg);
      if (box.w < minSize || box.h < minSize) continue;
      const closeEnough = Math.max(12, 0.2 * Math.min(box.w, box.h));
      if (dist(stroke[i]!, stroke[j]!) > closeEnough) continue;
      if (Math.abs(turned(seg)) >= (300 * Math.PI) / 180) return seg;
    }
  }
  return null;
}

/** Signed angle (radians) the path sweeps around the centre of its box. */
function turned(seg: readonly Pt[]): number {
  const box = bounds(seg);
  const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
  let total = 0;
  for (let k = 1; k < seg.length; k++) {
    const a = Math.atan2(seg[k - 1]!.y - c.y, seg[k - 1]!.x - c.x);
    const b = Math.atan2(seg[k]!.y - c.y, seg[k]!.x - c.x);
    let d = b - a;
    if (d > Math.PI) d -= 2 * Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    total += d;
  }
  return total;
}

/** The box around some points. */
export function bounds(points: readonly Pt[]): Rect {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * The area to capture around a circle: its box padded by `pad`, grown (around its centre)
 * to at least `min`, then slid and clipped so it stays on `screen`. All in points.
 */
export function inkCrop(points: readonly Pt[], screen: Rect, pad = 48, min = { w: 320, h: 220 }): Rect {
  const box = bounds(points);
  let w = Math.max(box.w + 2 * pad, min.w);
  let h = Math.max(box.h + 2 * pad, min.h);
  w = Math.min(w, screen.w);
  h = Math.min(h, screen.h);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const x = Math.min(Math.max(cx - w / 2, screen.x), screen.x + screen.w - w);
  const y = Math.min(Math.max(cy - h / 2, screen.y), screen.y + screen.h - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

/** Rough place of a point on the screen, in words: "top left", "middle", "bottom right"... */
export function spotName(p: Pt, screen: Rect): string {
  const col = Math.min(2, Math.max(0, Math.floor(((p.x - screen.x) / screen.w) * 3)));
  const row = Math.min(2, Math.max(0, Math.floor(((p.y - screen.y) / screen.h) * 3)));
  const v = ["top", "", "bottom"][row]!;
  const hz = ["left", "", "right"][col]!;
  return [v, hz].filter(Boolean).join(" ") || "middle";
}

/** "I circled something at the top left of the screen." */
export function circleSentence(loop: readonly Pt[], screen: Rect): string {
  const box = bounds(loop);
  const spot = spotName({ x: box.x + box.w / 2, y: box.y + box.h / 2 }, screen);
  return spot === "middle"
    ? "I circled something in the middle of the screen."
    : `I circled something at the ${spot} of the screen.`;
}
