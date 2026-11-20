// The dot-matrix look (ticket 42): pictures and 3D models drawn as square teal dots, like the
// orb. Luminance -> a 5-level teal ramp (the app's tokens, pixel.css) through an ordered Bayer
// 4x4 dither; near-black cells are dropped so the card's glass shows through. Pure maths here,
// the canvas painter is dither-paint.ts. Used by card-view.ts (image cards) and model3d.ts (model cards).
// Idea from Roamies (AGPL): idea only, no code.

/** --edge, --edge-hi, --edge-hot, --led, --ink: deep teal to near white. */
export const RAMP = ["#1d4a48", "#2f7c74", "#4fbfa9", "#78ffe2", "#e8fffa"] as const;
/** One dot's size in CSS px (with a 0.5 px gap inside it). */
export const CELL = 3;

export const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;
const bayer = (x: number, y: number) => (BAYER4[(y & 3) * 4 + (x & 3)]! + 0.5) / 16;

/** A brightness 0..1 at grid cell x, y -> level 0 (dropped) to 5 (RAMP[4]). */
export function levelAt(v: number, x: number, y: number): number {
  return Math.max(0, Math.min(RAMP.length, Math.floor(v * RAMP.length + bayer(x, y))));
}

export interface Cell {
  x: number;
  y: number;
  /** 1..5: RAMP[level - 1]. */
  level: number;
  /** The cell's dither threshold 0..1, so a reveal can show a stable subset. */
  t: number;
}

/** The lit cells of a cols x rows brightness grid. */
export function ditherCells(lum: ArrayLike<number>, cols: number, rows: number): Cell[] {
  const out: Cell[] = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const level = levelAt(lum[y * cols + x]!, x, y);
      if (level) out.push({ x, y, level, t: bayer(x + 1, y + 2) });
    }
  return out;
}

/** Reveal at progress 0..1: a sparse quarter of the dots with no glow, filling to all with glow. */
export function reveal(p: number): { density: number; glow: number } {
  const k = Math.max(0, Math.min(1, p));
  return { density: 0.25 + 0.75 * k * k, glow: Math.max(0, (k - 0.4) / 0.6) };
}

/**
 * A picture's RGBA pixels -> brightness 0..1 per pixel, stretched to the full range. A light
 * background (the border is bright: a diagram on white paper) is flipped, so the paper drops
 * out and the thing on it lights up, like a dark photo would.
 */
export function photoLum(px: ArrayLike<number>, w: number, h: number): Float32Array {
  const lum = new Float32Array(w * h);
  let lo = 1, hi = 0, edge = 0, edges = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = px[i * 4 + 3]! / 255;
      const v = ((0.2126 * px[i * 4]! + 0.7152 * px[i * 4 + 1]! + 0.0722 * px[i * 4 + 2]!) / 255) * a;
      lum[i] = v;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) (edge += v), edges++;
    }
  const flip = edges > 0 && edge / edges > 0.6;
  const span = hi - lo || 1;
  for (let i = 0; i < lum.length; i++) {
    const v = (lum[i]! - lo) / span;
    lum[i] = flip ? 1 - v : v;
  }
  return lum;
}
