// Where this overlay window sits on the screen, in global points (the space the core's
// screen rects use: top-left origin, main display at 0,0). The window covers the work area,
// so its origin is usually just under the menu bar. A browser preview has origin 0,0.
import { invoke } from "@tauri-apps/api/core";
import type { Rect } from "./layout.ts";

type Pt = { x: number; y: number };
let origin: Pt = { x: 0, y: 0 };

import { inTauri } from "./core-client.ts";

/** Ask the shell again (at start and when the window moves or resizes). */
export async function refreshOrigin(): Promise<Pt> {
  if (!inTauri()) return origin;
  const at = await invoke<[number, number] | null>("overlay_origin").catch(() => null);
  if (at) origin = { x: at[0], y: at[1] };
  return origin;
}

/** Use a known origin (demos and tests). */
export function setOrigin(p: Pt) {
  origin = p;
}

export const overlayOrigin = (): Pt => origin;

/** A global-point rect in this window's CSS pixels. */
export const toLocal = (r: Rect): Rect => ({ x: r.x - origin.x, y: r.y - origin.y, w: r.w, h: r.h });
