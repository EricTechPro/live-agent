// The window's side of batch 2 (pure): the orb's trip to where it works, the pill's ✓ and
// thinking dots, the Reminders card's sections.
import { expect, test } from "bun:test";
import { addWork, cuesFor, DONE_HOLD_MS, noWork, type Work } from "../app/src/cues.ts";
import { addAct, BUBBLE_W, GAP, travelSpot, type Act } from "../app/src/travel.ts";
import { reminderSections } from "../app/src/reminder-rows.ts";
import { CAN_DO, TRY_ME } from "../app/src/wizard-flow.ts";
import type { AgentEvent } from "../src/core/events.ts";
import type { Reminder } from "../src/reminders.ts";

const rect = { x: 1200, y: 200, w: 60, h: 20 };
const step = (state: "start" | "done" | "waiting", more: Partial<Act> = {}): AgentEvent => ({ type: "act.step", id: "a1", tool: "act_in_app", app: "CapCut", step: 1, of: 1, rect, say: "Setting it to 200.", state, ...more });

test("the act on screen follows act.step and ends with its call's result", () => {
  let act = addAct(undefined, step("start"));
  expect(act).toMatchObject({ id: "a1", rect, say: "Setting it to 200." });
  act = addAct(act, { type: "tool.result", id: "other", name: "x", status: "ok" });
  expect(act?.id).toBe("a1");
  expect(addAct(act, { type: "tool.result", id: "a1", name: "act_in_app", status: "waiting" })).toBe(act);
  expect(addAct(act, { type: "tool.result", id: "a1", name: "act_in_app", status: "ok" })).toBeUndefined();
  expect(addAct(act, { type: "turn.done", reply: "" })).toBeUndefined();
});

test("the orb sits GAP right of the control with its bubble further right, or all of it on the left", () => {
  const orb = { x: 18, y: 26, w: 112, h: 112 };
  const dock = { width: 148, height: 200 };
  const wide = travelSpot({ x: 300, y: 200, w: 60, h: 20 }, orb, dock, { width: 1440, height: 900 });
  expect(wide.side).toBe("right");
  expect(wide.at.x + orb.x).toBe(300 + 60 + GAP);
  // The orb's middle level with the control's.
  expect(wide.at.y + orb.y + orb.h / 2).toBe(210);
  const edge = travelSpot(rect, orb, dock, { width: 1440, height: 900 });
  expect(edge.side).toBe("left");
  expect(edge.at.x + orb.x + orb.w).toBe(rect.x - GAP);
  // Never over the control: the orb and the bubble's side both clear it.
  expect(edge.at.x + orb.x - BUBBLE_W).toBeLessThan(rect.x);
});

test("the pill: ✓ for a moment after a call, ✗ when it failed, dots while thinking", () => {
  let w: Work = addWork(noWork, { type: "tool.call", id: "a1", name: "act_in_app", args: { app: "CapCut" } });
  w = addWork(w, { type: "tool.result", id: "a1", name: "act_in_app", status: "ok" }, "en", 1000);
  expect(w.done).toEqual({ label: "Working in CapCut", ok: true, at: 1000 });
  // The turn ending right after keeps the tick.
  w = addWork(w, { type: "turn.done", reply: "" });
  const at = (now: number) => cuesFor({ look: "thinking", done: w.done, now, caption: {}, drawing: false }).pill;
  expect(at(1000 + DONE_HOLD_MS - 1)).toEqual({ kind: "done", text: "Working in CapCut", ok: true });
  expect(at(1000 + DONE_HOLD_MS)).toEqual({ kind: "think" });
  const failed = addWork(addWork(noWork, { type: "tool.call", id: "b", name: "open", args: { target: "Notes" } }), { type: "tool.result", id: "b", name: "open", status: "error" }, "en", 5);
  expect(failed.done).toMatchObject({ label: "Opening Notes", ok: false });
  // A call the model took back gets no tick.
  const dropped = addWork(addWork(noWork, { type: "tool.call", id: "c", name: "open", args: {} }), { type: "tool.result", id: "c", name: "open", status: "cancelled" });
  expect(dropped.done).toBeUndefined();
});

test("an act step's say goes in the bubble, before Jett's own words", () => {
  const cues = cuesFor({ look: "speaking", narrate: "Scale is on the right panel.", caption: { model: "Sure." }, drawing: true });
  expect(cues.bubble?.text).toBe("Scale is on the right panel.");
});

test("the Reminders card: Today (with overdue) and Later, soonest first, times on the right", () => {
  const now = new Date(2026, 10, 19, 14, 0);
  const r = (id: string, text: string, due: Date, done = false): Reminder => ({ id, text, due: due.toISOString(), created: now.toISOString(), ...(done ? { done } : {}) });
  const { today, later } = reminderSections(
    [r("3", "Post the video", new Date(2026, 10, 21, 9, 0)), r("1", "Go to the gym", new Date(2026, 10, 19, 17, 31)), r("0", "Call mum", new Date(2026, 10, 19, 13, 0)), r("x", "Old", now, true)],
    now,
  );
  expect(today.map((x) => x.text)).toEqual(["Call mum", "Go to the gym"]);
  expect(today[1]!.time).toBe("5:31 PM");
  expect(today[0]!.overdue).toBe(true);
  expect(later).toMatchObject([{ text: "Post the video", time: "Sat 9:00 AM" }]);
});

test("setup ends with what Jett can do and a turn to try", () => {
  expect(CAN_DO.length).toBeGreaterThanOrEqual(5);
  expect(CAN_DO.map((c) => c.what).join(" ")).toContain("Remind");
  expect(TRY_ME).toContain("draw");
});
