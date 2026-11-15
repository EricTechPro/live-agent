// The mini orb's job count (ticket 15): how many helper jobs are running right now.
import { expect, test } from "bun:test";
import { addJobEvent, emptyBoard, runningCount } from "../app/src/job-board.ts";
import type { AgentEvent } from "../src/core/events.ts";

const job = (id: string, state: "queued" | "running" | "done" | "failed" | "cancelled"): AgentEvent => ({
  type: "job.state", id, kind: "gemini-cli", title: `task ${id}`, state,
});
const count = (events: AgentEvent[]) => runningCount(events.reduce(addJobEvent, emptyBoard));

test("no jobs: the orb shows zero", () => {
  expect(count([])).toBe(0);
});

test("only working jobs count; waiting and finished ones do not", () => {
  expect(count([job("a", "running"), job("b", "queued"), job("c", "done"), job("d", "failed"), job("e", "cancelled")])).toBe(1);
});

test("the count follows jobs live as they start and finish", () => {
  const events = [job("a", "queued"), job("a", "running"), job("b", "queued"), job("b", "running"), job("a", "done")];
  const seen = events.map((_, i) => count(events.slice(0, i + 1)));
  expect(seen).toEqual([0, 1, 1, 2, 1]);
});
