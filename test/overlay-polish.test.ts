// v3 polish (ticket 38): drag anywhere, the minimised dot, hover from the poll, push to talk that always lets go.
import { expect, test } from "bun:test";
import {
  DOT_INSET, DOUBLE_MS, DRAG_PX, dotFor, dropDot, HOVER_PAD, hoverOrb, isDoubleClick, pollHover, isDrag, pttCallIdle, pttPress, pttRelease, SNAP_PX,
} from "../app/src/overlay.ts";

const view = { width: 1440, height: 900 };
const dot = { width: 20, height: 20 };

test("a press that barely moves is a click; past the threshold it is a drag", () => {
  const from = { x: 100, y: 100 };
  expect(isDrag(from, { x: 100, y: 100 })).toBe(false);
  expect(isDrag(from, { x: 102, y: 102 })).toBe(false);
  expect(isDrag(from, { x: 100 + DRAG_PX, y: 100 })).toBe(false);
  expect(isDrag(from, { x: 100 + DRAG_PX + 1, y: 100 })).toBe(true);
  expect(isDrag(from, { x: 96, y: 95 })).toBe(true);
});

test("two clicks close together are a double-click", () => {
  expect(isDoubleClick(undefined, 1000)).toBe(false);
  expect(isDoubleClick(1000, 1000 + DOUBLE_MS - 1)).toBe(true);
  expect(isDoubleClick(1000, 1000 + DOUBLE_MS + 1)).toBe(false);
});

test("the dot stays where it is dropped, away from the edges", () => {
  expect(dropDot({ x: 600, y: 400 }, dot, view)).toEqual({ x: 600, y: 400 });
});

test("the dot snaps to an edge only when dropped within 24 px of it", () => {
  expect(SNAP_PX).toBe(24);
  expect(dropDot({ x: DOT_INSET + 20, y: 400 }, dot, view)).toEqual({ x: DOT_INSET, y: 400 });
  expect(dropDot({ x: DOT_INSET + 30, y: 400 }, dot, view)).toEqual({ x: DOT_INSET + 30, y: 400 });
  expect(dropDot({ x: 1440 - 20 - DOT_INSET - 10, y: 400 }, dot, view)).toEqual({ x: 1440 - 20 - DOT_INSET, y: 400 });
  expect(dropDot({ x: 600, y: 900 - 20 - DOT_INSET - 5 }, dot, view)).toEqual({ x: 600, y: 900 - 20 - DOT_INSET });
  expect(dropDot({ x: 10, y: 12 }, dot, view)).toEqual({ x: DOT_INSET, y: DOT_INSET });
});

test("the dot is kept on screen", () => {
  expect(dropDot({ x: -300, y: 5000 }, dot, view)).toEqual({ x: DOT_INSET, y: 900 - 20 - DOT_INSET });
});

test("minimising sends the dot to the screen edge nearest the orb, level with it", () => {
  const orb = { x: 1240, y: 500, width: 148, height: 200 };
  expect(dotFor(orb, dot, view)).toEqual({ x: 1440 - 20 - DOT_INSET, y: 600 - 10 });
  const top = { x: 600, y: 20, width: 148, height: 200 };
  expect(dotFor(top, dot, view)).toEqual({ x: 674 - 10, y: DOT_INSET });
  const left = { x: 30, y: 300, width: 148, height: 200 };
  expect(dotFor(left, dot, view).x).toBe(DOT_INSET);
});

test("hover: the cursor over the orb or within the padding around it", () => {
  const orb = { x: 1000, y: 500, width: 148, height: 200 };
  expect(hoverOrb({ x: 1070, y: 600 }, orb)).toBe(true);
  expect(hoverOrb({ x: 1000 - HOVER_PAD, y: 600 }, orb)).toBe(true);
  expect(hoverOrb({ x: 1000 - HOVER_PAD - 1, y: 600 }, orb)).toBe(false);
  expect(hoverOrb({ x: 200, y: 200 }, orb)).toBe(false);
  expect(hoverOrb(undefined, orb)).toBe(false);
});

test("push to talk with no call: the press starts one, the release mutes it", () => {
  const press = pttPress(pttCallIdle, "off", false);
  expect(press.act).toBe("start");
  const release = pttRelease(press.state, "live");
  expect(release.act).toBe("mute");
  expect(release.state).toEqual(pttCallIdle);
});

test("let go before the call connects: the mute waits and happens once it is live", () => {
  const press = pttPress(pttCallIdle, "off", false);
  const release = pttRelease(press.state, "joining");
  expect(release.act).toBeUndefined();
  expect(release.state.muteOnLive).toBe(true);
});

test("press again while it is still connecting: talking wins again, nothing waits", () => {
  const first = pttRelease(pttPress(pttCallIdle, "off", false).state, "joining").state;
  const again = pttPress(first, "joining", false);
  expect(again.act).toBeUndefined();
  expect(again.state.muteOnLive).toBe(false);
  expect(pttRelease(again.state, "live").act).toBe("mute");
});

test("an open mic before the press stays open after it", () => {
  const press = pttPress(pttCallIdle, "live", false);
  expect(press.act).toBeUndefined();
  expect(pttRelease(press.state, "live").act).toBeUndefined();
});

test("muted before the press: unmute while held, mute again on release", () => {
  const press = pttPress(pttCallIdle, "live", true);
  expect(press.act).toBe("unmute");
  expect(pttRelease(press.state, "live").act).toBe("mute");
});

test("a call you started by click, still connecting: holding and letting go does not mute it", () => {
  const press = pttPress(pttCallIdle, "joining", false);
  expect(pttRelease(press.state, "joining").state.muteOnLive).toBe(false);
});

test("hover clears on the first poll the cursor is away, and the tooltip goes with it (ticket 39)", () => {
  const orb = { x: 1000, y: 500, width: 148, height: 200 };
  expect(pollHover(false, { x: 1070, y: 600 }, orb)).toEqual({ hover: true, hideTip: false });
  // Moved 1000 px away to another app: no DOM event comes, the poll still sees it.
  expect(pollHover(true, { x: 70, y: 600 }, orb)).toEqual({ hover: false, hideTip: true });
  // Off this screen.
  expect(pollHover(true, undefined, orb)).toEqual({ hover: false, hideTip: true });
  expect(pollHover(false, { x: 70, y: 600 }, orb)).toEqual({ hover: false, hideTip: false });
});
