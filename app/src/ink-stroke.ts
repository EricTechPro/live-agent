// The circle gesture's look (ticket 43), pure so it is tested apart from the canvas
// (screen-ink.ts draws it): the stroke style, Chaikin smoothing, the listening pill at the
// pointer, and where the ghost orb and its answer bubble go on the circled spot.
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

/** The middle of a drawn loop: the centre of its bounds (a lopsided run-up doesn't pull it). */
export function loopCentre(loop: Pt[]): Pt {
  const xs = loop.map((p) => p.x), ys = loop.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

/** Ghost orb size (pt) and the gap from its edge to the bubble. */
export const GHOST = { size: 96, gap: 18 } as const;

/** The ghost orb's box on the circle's centre, and its bubble beside it: right, or left when the right has no room. */
export function ghostPlace(centre: Pt, view: { width: number; height: number }, bubbleW: number) {
  const r = GHOST.size / 2;
  const orb = { x: centre.x - r, y: centre.y - r, w: GHOST.size, h: GHOST.size };
  const side: "left" | "right" = centre.x + r + GHOST.gap + bubbleW > view.width - 12 ? "left" : "right";
  const x = side === "right" ? centre.x + r + GHOST.gap : Math.max(12, centre.x - r - GHOST.gap - bubbleW);
  const y = Math.max(12, Math.min(view.height - 60, centre.y - 18));
  return { orb, side, bubble: { x, y } };
}
