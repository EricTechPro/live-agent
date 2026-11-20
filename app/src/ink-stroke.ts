// The circle gesture's look (ticket 43), pure so it is tested apart from the canvas
// (screen-ink.ts draws it): the stroke style, Chaikin smoothing, the listening pill at the
// pointer, and the circled spot the real orb travels beside (app/src/travel.ts).
// Idea from Roamies (AGPL) and the feel of ScreenBrush: ideas only, no code.
import type { Pt } from "../../src/screen/geometry.ts";

/** Mint core over a 1 pt darker teal edge (readable on white pages), round caps, no glow. */
export const INK = { core: "#6ff0dc", edge: "#1f9f90", width: 4.5, edgeWidth: 6.5, alpha: 0.9, glow: 0, fadeMs: 500 } as const;

/** Chaikin corner cutting: each pass swaps every segment for its 1/4 and 3/4 points; the ends stay. */
export function smooth(points: Pt[], passes = 2): Pt[] {
  let pts = points;
  for (let n = 0; n < passes && pts.length > 2; n++) {
    const out: Pt[] = [pts[0]!];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    out.push(pts.at(-1)!);
    pts = out;
  }
  return pts;
}

/** The listening pill: 36 x 14, its bottom-left corner 8 pt up and right of the pointer tip. */
export function pillRect(at: Pt): { x: number; y: number; w: number; h: number } {
  return { x: at.x + 8, y: at.y - 8 - 14, w: 36, h: 14 };
}

/** The bounds of a drawn loop: the orb travels beside this box, so it never covers the circled thing. */
export function loopBounds(loop: Pt[]): { x: number; y: number; w: number; h: number } {
  const xs = loop.map((p) => p.x), ys = loop.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
