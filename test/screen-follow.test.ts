// Following the screen while a drawing is up (src/screen/follow.ts): the front window goes to
// the window as `screen.front` (cards keep off it), and marks pinned to a window go stale when
// it moves, the app switches, the page changes, or the user scrolls or clicks in it.
import { describe, expect, test } from "bun:test";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent } from "../src/core/events.ts";
import type { Eyes, FrontWindow, WatchEvent } from "../src/screen/eyes.ts";
import { createFollow, staleReason } from "../src/screen/follow.ts";
import { scriptedModel } from "../src/models/scripted.ts";
import draw from "../tools/draw.ts";

const chrome: FrontWindow = { app: "Google Chrome", pid: 42, windowId: 7, title: "Pricing", bounds: { x: 100, y: 50, w: 900, h: 700 } };

describe("staleReason", () => {
  test("the same window, same place: still good", () => {
    expect(staleReason(chrome, { type: "front", front: { ...chrome } })).toBeUndefined();
  });
  test("app switch, other window, moved, resized, new page, closed", () => {
    expect(staleReason(chrome, { type: "front", front: { ...chrome, pid: 9, app: "Finder" } })).toBe("switched to Finder");
    expect(staleReason(chrome, { type: "front", front: { ...chrome, windowId: 8 } })).toBe("switched window");
    expect(staleReason(chrome, { type: "front", front: { ...chrome, bounds: { ...chrome.bounds!, x: 140 } } })).toBe("the window moved");
    expect(staleReason(chrome, { type: "front", front: { ...chrome, bounds: { ...chrome.bounds!, w: 800 } } })).toBe("the window moved");
    expect(staleReason(chrome, { type: "front", front: { ...chrome, title: "Checkout" } })).toBe("the page changed");
    expect(staleReason(chrome, { type: "front", front: null })).toBe("the window closed");
  });
  test("a 1 pt wobble is not a move", () => {
    expect(staleReason(chrome, { type: "front", front: { ...chrome, bounds: { ...chrome.bounds!, x: 101 } } })).toBeUndefined();
  });
  test("scrolls and clicks count only inside the marked window", () => {
    expect(staleReason(chrome, { type: "scroll", at: { x: 500, y: 400 } })).toBe("scrolled");
    expect(staleReason(chrome, { type: "click", at: { x: 500, y: 400 } })).toBe("clicked");
    expect(staleReason(chrome, { type: "scroll", at: { x: 1300, y: 400 } })).toBeUndefined();
  });
});

function watchingEyes() {
  let listener: ((e: WatchEvent) => void) | undefined;
  let starts = 0;
  let stops = 0;
  const eyes: Pick<Eyes, "watch"> = {
    watch(on) {
      starts++;
      listener = on;
      return () => {
        stops++;
        listener = undefined;
      };
    },
  };
  return { eyes, send: (e: WatchEvent) => listener?.(e), counts: () => ({ starts, stops }), watching: () => !!listener };
}

describe("createFollow", () => {
  test("pinned marks go stale once, and the watch stops when nothing needs it", () => {
    const w = watchingEyes();
    const events: AgentEvent[] = [];
    const stale: [string[], string][] = [];
    const follow = createFollow({ eyes: w.eyes, emit: (e) => events.push(e), onStale: (ids, why) => stale.push([ids, why]) });
    follow.pin(["p1", "p2"], chrome);
    expect(w.watching()).toBe(true);
    w.send({ type: "front", front: chrome });
    expect(stale).toEqual([]);
    expect(events).toEqual([{ type: "screen.front", front: chrome }]);
    w.send({ type: "scroll", at: { x: 300, y: 300 } });
    expect(stale).toEqual([[["p1", "p2"], "scrolled"]]);
    expect(w.watching()).toBe(false);
    w.send({ type: "scroll", at: { x: 300, y: 300 } });
    expect(stale.length).toBe(1);
  });
});

describe("through the session", () => {
  test("a card on screen starts the watch; the front window goes out as screen.front; a new chat stops it", async () => {
    const w = watchingEyes();
    const eyes = { ...w.eyes, permission: async () => true, requestPermission: async () => true, state: async () => ({ display: { x: 0, y: 0, w: 1512, h: 982 }, front: chrome }), shot: async () => { throw new Error("no"); } } as Eyes;
    const model = scriptedModel([
      [{ type: "tool.call", id: "d1", name: "draw", args: { beats: [{ say: "Three steps.", marks: [{ kind: "list", id: "p1", items: [{ label: "a" }] }] }] } }],
      [{ type: "text", text: "There." }],
    ]);
    const session = await startSession({ model, tools: [draw], eyes, chatEndNote: false });
    const seen: AgentEvent[] = [];
    session.onEvent((e) => seen.push(e));
    expect(w.watching()).toBe(false);
    await session.sendText("list it");
    expect(w.watching()).toBe(true);
    w.send({ type: "front", front: chrome });
    expect(seen.filter((e) => e.type === "screen.front")).toEqual([{ type: "screen.front", front: chrome }]);
    await session.newChat();
    expect(w.watching()).toBe(false);
    await session.close();
  });
});
