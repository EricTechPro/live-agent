// Ticket 40: "why does it follow my cursor". A drag whose button-up WebKit never delivered
// stayed on: the full-screen window kept the mouse (`hold`) and every move went to the
// orb. Now a drag ends on any sign the press is over (overlay.ts `dragEnd`).
import { describe, expect, test } from "bun:test";
import { DRAG_IDLE_MS, dragEnd } from "../app/src/overlay.ts";

const drag = { startedAt: 1000, lastMoveAt: 1000 };

describe("a drag always ends", () => {
  test("the Rust poll reads the left button up (asked after the press began)", () => {
    expect(dragEnd(drag, { now: 1100, poll: { askedAt: 1050, buttonDown: false } })).toBe("button-up");
  });

  test("a poll asked before the press began says nothing about this drag", () => {
    expect(dragEnd(drag, { now: 1100, poll: { askedAt: 990, buttonDown: false } })).toBeUndefined();
  });

  test("the button still down: the drag goes on, even held still for a while", () => {
    expect(dragEnd(drag, { now: 1000 + DRAG_IDLE_MS * 3, poll: { askedAt: 1050, buttonDown: true } })).toBeUndefined();
  });

  test("blur and Esc end it", () => {
    expect(dragEnd(drag, { now: 1100, blur: true })).toBe("blur");
    expect(dragEnd(drag, { now: 1100, escape: true })).toBe("escape");
  });

  test("no poll (a browser preview) and no movement for a few seconds ends it", () => {
    expect(dragEnd(drag, { now: 1000 + DRAG_IDLE_MS - 1 })).toBeUndefined();
    expect(dragEnd(drag, { now: 1000 + DRAG_IDLE_MS + 1 })).toBe("idle");
    expect(dragEnd({ startedAt: 1000, lastMoveAt: 3000 }, { now: 3000 + DRAG_IDLE_MS - 1 })).toBeUndefined();
  });
});
