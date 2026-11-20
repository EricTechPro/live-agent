// The orb travels to where it works (gap #1, Roamies-like, our own code). Pure.
//
// While `act_in_app` (or `guide`) works on a control, the orb, its bubble and the
// "working in CapCut" pill sit beside that control; when the call is done they go home.
// The orb sits GAP to the right of the control, bubble further right; with no room for
// the bubble there, everything goes to the control's left instead, so nothing ever
// covers the thing being clicked.
import type { AgentEvent, EventOf } from "../../src/core/events.ts";
import { EDGE, type Point, type Size } from "./overlay.ts";

export type Act = Omit<EventOf<"act.step">, "type">;

/** The act step on screen now, or none: the orb is home. */
export function addAct(act: Act | undefined, event: AgentEvent): Act | undefined {
  switch (event.type) {
    case "act.step": {
      const { type: _, ...step } = event;
      return step;
    }
    case "tool.result":
      return act && event.id === act.id && event.status !== "waiting" ? undefined : act;
    case "turn.done":
    case "chat.started":
      return undefined;
    default:
      return act;
  }
}

/** Space between the control and the orb's edge. */
export const GAP = 40;
/** The bubble's widest (style.css `.cues`). */
export const BUBBLE_W = 380;

type Box = { x: number; y: number; w: number; h: number };

/**
 * Where the dock goes so its orb (`orb`: the orb's box inside the dock) sits beside `target`
 * (both in overlay CSS pixels), and which side the cues hang on.
 */
export function travelSpot(target: Box, orb: Box, dock: Size, view: Size): { at: Point; side: "left" | "right" } {
  const cy = target.y + target.h / 2;
  const y = Math.round(Math.max(EDGE, Math.min(cy - orb.y - orb.h / 2, view.height - dock.height - EDGE)));
  const rightOrb = target.x + target.w + GAP;
  if (rightOrb + orb.w + 6 + BUBBLE_W <= view.width - EDGE) return { at: { x: Math.round(rightOrb - orb.x), y }, side: "right" };
  const leftOrb = target.x - GAP - orb.w;
  return { at: { x: Math.round(Math.max(EDGE - orb.x, leftOrb - orb.x)), y }, side: "left" };
}
