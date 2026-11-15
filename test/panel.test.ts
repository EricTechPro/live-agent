// The control center's right panel (ticket 25): Canvas and Jobs tabs.
import { expect, test } from "bun:test";
import { nextPanel, startPanel, tabForKey, type PanelAction } from "../app/src/panel.ts";
import type { AgentEvent } from "../src/core/events.ts";

const run = (inputs: (PanelAction | AgentEvent)[], from = startPanel) => inputs.reduce(nextPanel, from);
const job = (id: string, state: "queued" | "running" | "done"): AgentEvent => ({ type: "job.state", id, kind: "gemini-cli", title: id, state });
const diagram: AgentEvent = { type: "diagram", id: "d1", source: "flowchart LR\n a --> b" };

test("the panel starts open on Canvas", () => {
  expect(startPanel).toEqual({ open: true, tab: "canvas" });
});

test("clicking a tab selects it", () => {
  expect(run([{ type: "panel.select", tab: "jobs" }])).toEqual({ open: true, tab: "jobs" });
});

test("a diagram opens the Canvas tab, even from a closed panel on Jobs", () => {
  expect(run([{ type: "panel.select", tab: "jobs" }, { type: "panel.close" }, diagram])).toEqual({ open: true, tab: "canvas" });
});

test("a sketch canvas event opens the Canvas tab too", () => {
  const beat = { type: "canvas.beat", id: "c1", beat: 0, say: "Here", marks: [] } as unknown as AgentEvent;
  expect(run([{ type: "panel.select", tab: "jobs" }, beat]).tab).toBe("canvas");
});

test("a job starting does not switch tabs", () => {
  const before = run([{ type: "panel.select", tab: "canvas" }]);
  expect(run([job("a", "queued"), job("a", "running")], before)).toBe(before);
});

test("X closes the panel; the Jobs icon opens it on Jobs, and closes it when already there", () => {
  const closed = run([{ type: "panel.close" }]);
  expect(closed.open).toBe(false);
  const jobs = run([{ type: "panel.jobs-button" }], closed);
  expect(jobs).toEqual({ open: true, tab: "jobs" });
  expect(run([{ type: "panel.jobs-button" }], jobs).open).toBe(false);
  expect(run([{ type: "panel.jobs-button" }])).toEqual({ open: true, tab: "jobs" });
});

test("arrow keys move between tabs and wrap; Home and End jump", () => {
  expect(tabForKey("canvas", "ArrowRight")).toBe("jobs");
  expect(tabForKey("jobs", "ArrowRight")).toBe("canvas");
  expect(tabForKey("canvas", "ArrowLeft")).toBe("jobs");
  expect(tabForKey("jobs", "Home")).toBe("canvas");
  expect(tabForKey("canvas", "End")).toBe("jobs");
  expect(tabForKey("canvas", "Enter")).toBeUndefined();
});
