// Paints dither.ts's cells on a canvas (ticket 42): the glow under the bright dots, then every
// dot crisp on top. Apart from dither.ts so its maths is tested without a DOM.
import { RAMP, reveal, type Cell } from "./dither.ts";

/** Glow on the bright dots: --led. */
const GLOW = "#78ffe2";

/** Paint the cells at `cell` px each from (ox, oy); `density` keeps that share of them. */
export function paintCells(ctx: CanvasRenderingContext2D, cells: Cell[], cell: number, ox: number, oy: number, p = 1) {
  const { density, glow } = reveal(p);
  const size = cell - 0.5;
  // Two passes: the glow under the bright dots, then every dot crisp on top.
  if (glow > 0) {
    ctx.save();
    ctx.shadowColor = GLOW;
    ctx.shadowBlur = 8;
    ctx.globalAlpha = 0.6 * glow;
    ctx.fillStyle = GLOW;
    for (const c of cells) if (c.level >= 4 && c.t < density) ctx.fillRect(ox + c.x * cell, oy + c.y * cell, size, size);
    ctx.restore();
  }
  for (let level = 1; level <= RAMP.length; level++) {
    ctx.fillStyle = RAMP[level - 1]!;
    for (const c of cells) if (c.level === level && c.t < density) ctx.fillRect(ox + c.x * cell, oy + c.y * cell, size, size);
  }
}

