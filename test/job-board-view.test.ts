// The window's job board and bottom bar, built from the core's events (ticket 10).
import { expect, test } from "bun:test";
import { addBarEvent, emptyBar, MODE_LABELS } from "../app/src/bottom-bar.ts";
import { addJobEvent, emptyBoard } from "../app/src/job-board.ts";
import type { AgentEvent } from "../src/core/events.ts";

const board = (events: AgentEvent[]) => events.reduce(addJobEvent, emptyBoard);
const bar = (events: AgentEvent[]) => events.reduce(addBarEvent, emptyBar);
const job = (id: string, state: "queued" | "running" | "done" | "failed" | "cancelled", message?: string): AgentEvent => ({
  type: "job.state", id, kind: "gemini-cli", title: `task ${id}`, state, ...(message ? { message } : {}),
});

test("each job shows once, in the order it started, with its latest state in board words", () => {
  expect(
    board([job("job-1", "queued"), job("job-2", "queued"), job("job-1", "running"), job("job-1", "done", "Fixed it.")]),
  ).toEqual([
    { id: "job-1", title: "task job-1", status: "done", message: "Fixed it.", cancellable: false },
    { id: "job-2", title: "task job-2", status: "waiting", cancellable: true },
  ]);
});

test("waiting and working jobs can be cancelled; failed and cancelled ones cannot", () => {
  const rows = board([job("a", "running"), job("b", "failed", "boom: try again"), job("c", "cancelled")]);
  expect(rows.map((r) => [r.id, r.status, r.cancellable])).toEqual([
    ["a", "working", true],
    ["b", "failed", false],
    ["c", "cancelled", false],
  ]);
});

test("other events leave the board alone", () => {
  const before = board([job("a", "running")]);
  expect(addJobEvent(before, { type: "turn.done", reply: "hi" })).toBe(before);
});

test("the bar shows the notes the last answer used, once that answer is done", () => {
  const b = bar([
    { type: "notes.used", notes: ["wiki/sourdough-starter.md"] },
    { type: "turn.done", reply: "Gus." },
  ]);
  expect(b.notes).toEqual(["wiki/sourdough-starter.md"]);
});

test("an answer that used no notes clears the notes from the one before", () => {
  const b = bar([
    { type: "notes.used", notes: ["wiki/a.md"] },
    { type: "turn.done", reply: "A." },
    { type: "turn.done", reply: "Hello." },
  ]);
  expect(b.notes).toEqual([]);
});

test("the bar's mode comes only from the core's mode.changed events", () => {
  expect(emptyBar.mode).toBeUndefined();
  const b = bar([{ type: "mode.changed", mode: "bypass" }, { type: "mode.changed", mode: "ask-me" }]);
  expect(b.mode).toBe("ask-me");
  expect(MODE_LABELS).toEqual({ "ask-me": "Ask me", "auto-edits": "Auto edits", bypass: "Bypass" });
});

test("only Shift+Tab cycles the mode; plain Tab still moves focus", async () => {
  const { isModeCycleKey } = await import("../app/src/bottom-bar.ts");
  const key = (k: string, mods: Partial<Record<"shiftKey" | "altKey" | "ctrlKey" | "metaKey", boolean>> = {}) =>
    ({ key: k, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...mods });
  expect(isModeCycleKey(key("Tab", { shiftKey: true }))).toBe(true);
  expect(isModeCycleKey(key("Tab"))).toBe(false);
  expect(isModeCycleKey(key("Tab", { shiftKey: true, metaKey: true }))).toBe(false);
});
