// The window's job board and bottom bar, built from the core's events (ticket 10),
// and the readable job cards (ticket 29).
import { expect, test } from "bun:test";
import { addBarEvent, emptyBar } from "../app/src/bottom-bar.ts";
import { addJobEvent, elapsed, emptyBoard, HELPER_LABELS } from "../app/src/job-board.ts";
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
    { id: "job-1", title: "task job-1", status: "done", helper: "gemini-cli", helperLabel: "Gemini CLI", message: "Fixed it.", cancellable: false },
    { id: "job-2", title: "task job-2", status: "waiting", helper: "gemini-cli", helperLabel: "Gemini CLI", cancellable: true },
  ]);
});

test("a card carries the helper, its folder, the times, and when done a one-line summary plus the full output", () => {
  const base = { type: "job.state", id: "job-1", kind: "claude-code", title: "Fix flaky login test", folder: "/Users/eric/brain/projects/app" } as const;
  const rows = board([
    { ...base, state: "queued" },
    { ...base, state: "running", startedAt: 1000 },
    { ...base, state: "done", startedAt: 1000, endedAt: 66_000, message: "Fixed it.\nMore.", summary: "Fixed it.", output: "Fixed it.\nMore." },
  ]);
  expect(rows).toEqual([
    {
      id: "job-1", title: "Fix flaky login test", status: "done", helper: "claude-code", helperLabel: "Claude Code",
      folder: "/Users/eric/brain/projects/app", startedAt: 1000, endedAt: 66_000,
      message: "Fixed it.\nMore.", summary: "Fixed it.", output: "Fixed it.\nMore.", cancellable: false,
    },
  ]);
});

test("every helper has a plain name; an unknown kind shows as it is", () => {
  expect(HELPER_LABELS).toMatchObject({ "gemini-cli": "Gemini CLI", codex: "Codex", "claude-code": "Claude Code", tidy: "Tidy" });
  const [row] = board([{ type: "job.state", id: "j", kind: "other", title: "t", state: "queued" }]);
  expect(row!.helperLabel).toBe("other");
});

test("elapsed time ticks while working and stops when the job ends", () => {
  expect(elapsed({}, 5000)).toBe("");
  expect(elapsed({ startedAt: 1000 }, 1000)).toBe("0s");
  expect(elapsed({ startedAt: 1000 }, 13_400)).toBe("12s");
  expect(elapsed({ startedAt: 0 }, 185_000)).toBe("3m 05s");
  expect(elapsed({ startedAt: 0 }, 3_725_000)).toBe("1h 02m");
  expect(elapsed({ startedAt: 1000, endedAt: 61_000 }, 999_999)).toBe("1m 00s");
});

test("a failed card keeps the fix as its one line, and the whole error to expand", () => {
  const [row] = board([{ type: "job.state", id: "j", kind: "codex", title: "t", state: "failed", message: "Codex is not signed in. Run codex login.", summary: "Codex is not signed in.", output: "Codex is not signed in. Run codex login." }]);
  expect(row).toMatchObject({ status: "failed", summary: "Codex is not signed in.", output: "Codex is not signed in. Run codex login." });
});

test("a job in its own worktree shows the worktree's branch and path", () => {
  const worktree = { path: "/data/live-agent/worktrees/app/fix-20261114-101500", branch: "live-agent/fix-20261114-101500" };
  const rows = board([{ ...job("job-1", "queued"), worktree } as AgentEvent, { ...job("job-1", "done", "Fixed."), worktree } as AgentEvent]);
  expect(rows[0]!.worktree).toEqual(worktree);
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
});

test("only Shift+Tab cycles the mode; plain Tab still moves focus", async () => {
  const { isModeCycleKey } = await import("../app/src/bottom-bar.ts");
  const key = (k: string, mods: Partial<Record<"shiftKey" | "altKey" | "ctrlKey" | "metaKey", boolean>> = {}) =>
    ({ key: k, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...mods });
  expect(isModeCycleKey(key("Tab", { shiftKey: true }))).toBe(true);
  expect(isModeCycleKey(key("Tab"))).toBe(false);
  expect(isModeCycleKey(key("Tab", { shiftKey: true, metaKey: true }))).toBe(false);
});
