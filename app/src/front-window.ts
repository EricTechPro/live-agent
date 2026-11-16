// The front app's window on screen (drawing v2): drawing cards never cover it.
//
//   setFrontWindowSource(() => rect)   // the screen-aware slice plugs in here
//   frontWindowMoved()                 // ... and calls this when the window moves
//   frontWindow()                      // main.ts adds it to the cards' obstacles
//
// A stub for now: nothing knows where the front window is yet, so it returns
// undefined and cards only avoid Jett's own orb and panels. A window that fills
// (nearly) the whole screen leaves no room beside it; main.ts then ignores it and
// cards go over it, as they would on an empty desktop.
import type { Rect } from "./layout.ts";

type Source = () => Rect | undefined;
let source: Source = () => undefined;
const listeners = new Set<() => void>();

export function setFrontWindowSource(fn: Source) {
  source = fn;
  frontWindowMoved();
}

export function frontWindowMoved() {
  for (const fn of listeners) fn();
}

export function onFrontWindowMoved(fn: () => void) {
  listeners.add(fn);
}

export const frontWindow = (): Rect | undefined => source();

/** True when a window leaves too little room beside it to place cards (about 80% of the screen or more). */
export const fillsScreen = (r: Rect, view: { width: number; height: number }) => r.w * r.h >= 0.8 * view.width * view.height;
