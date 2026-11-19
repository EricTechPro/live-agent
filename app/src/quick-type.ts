// Quick typing (ticket 40): a small glass field under the orb, so you can type to Jett
// without opening the popover. Pure: what is open and typed, plus an action, in; the new
// state, the text to send and what to do with keyboard focus out. main.ts does the DOM.
//
// - Opens from a click on the orb (a second click closes it), ⌃⌥T (global), or starting
//   to type while Jett has focus (the first letter is kept).
// - Enter sends the text as a typed turn and stays open, empty, so you read the reply in
//   the bubble; Shift+Enter is a new line; Esc closes.
// - While it is open Jett's voice is muted (main.ts): you type, you read.
// - While it is open the window holds keyboard focus ("take"); closing gives it back to
//   the app you were in ("give").
import type { Point, Rect, Size } from "./overlay.ts";

export interface Quick {
  open: boolean;
  text: string;
}

export const quickClosed: Quick = { open: false, text: "" };

export type QuickAction =
  | { type: "open"; seed?: string }
  | { type: "close" }
  | { type: "input"; text: string }
  | { type: "key"; key: string; shift: boolean };

export interface QuickStep {
  quick: Quick;
  /** A typed turn to send now. */
  send?: string;
  /** Take keyboard focus for the window, or give it back to the app before. */
  focus?: "take" | "give";
}

export function nextQuick(q: Quick, action: QuickAction): QuickStep {
  switch (action.type) {
    case "open":
      if (q.open) return { quick: q };
      return { quick: { open: true, text: action.seed ?? "" }, focus: "take" };
    case "close":
      return q.open ? { quick: quickClosed, focus: "give" } : { quick: q };
    case "input":
      return { quick: q.open ? { ...q, text: action.text } : q };
    case "key": {
      if (!q.open) return { quick: q };
      if (action.key === "Escape") return { quick: quickClosed, focus: "give" };
      if (action.key !== "Enter" || action.shift) return { quick: q };
      const text = q.text.trim();
      return text ? { quick: { open: true, text: "" }, send: text } : { quick: q };
    }
  }
}

/**
 * A key that starts quick typing while Jett has focus: one printable character, no
 * Cmd / Ctrl / Option, not inside another field, and not Space (talk) or ? (shortcuts).
 */
export function isQuickTypeStart(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }, inField: boolean): boolean {
  if (inField || e.metaKey || e.ctrlKey || e.altKey) return false;
  if ([...e.key].length !== 1) return false; // Enter, ArrowUp, Tab...
  return e.key !== " " && e.key !== "?";
}

const GAP = 8;
const EDGE = 8;

/**
 * Where the field goes: centred under the orb (above it when there is no room below), or,
 * minimised, beside the pill on the side away from its screen edge, level with its middle.
 */
export function quickPlace(by: Rect, field: Size, view: Size, pillSide: "left" | "right" | undefined): Point {
  const clampX = (x: number) => Math.max(EDGE, Math.min(view.width - field.width - EDGE, x));
  const clampY = (y: number) => Math.max(EDGE, Math.min(view.height - field.height - EDGE, y));
  if (pillSide) {
    const x = pillSide === "right" ? by.x - field.width - GAP - 2 : by.x + by.width + GAP + 2;
    return { x: clampX(x), y: clampY(by.y + by.height / 2 - field.height / 2) };
  }
  const below = by.y + by.height + GAP;
  const y = below + field.height + EDGE <= view.height ? below : by.y - field.height - GAP;
  return { x: clampX(by.x + by.width / 2 - field.width / 2), y: clampY(y) };
}
