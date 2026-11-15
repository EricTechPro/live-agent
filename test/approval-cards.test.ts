// The approve / deny cards by the composer (ticket 28, window half).
import { expect, test } from "bun:test";
import { addApprovalEvent, describeCall, noApprovals } from "../app/src/approvals.ts";
import type { AgentEvent } from "../src/core/events.ts";

const feed = (events: AgentEvent[]) => events.reduce(addApprovalEvent, noApprovals).cards;

const call: AgentEvent = {
  type: "tool.call", id: "c1", name: "start_helper", risk: "helper",
  args: { helper: "claude-code", task: "fix the login test", folder: "~/code/app" },
};
const verdict = (v: "ask" | "allow" | "block"): AgentEvent => ({
  type: "safety.verdict", id: "c1", name: "start_helper", risk: "helper", mode: "ask-me", verdict: v, reason: "",
});
const result = (status: "ok" | "waiting" | "declined" | "cancelled"): AgentEvent => ({ type: "tool.result", id: "c1", name: "start_helper", status });

test("an ask verdict shows a card saying what the call will do", () => {
  expect(feed([call, verdict("ask"), result("waiting")])).toEqual([
    { id: "c1", name: "start_helper", what: "Claude Code: fix the login test, in ~/code/app" },
  ]);
});

test("an allow verdict (approved by voice or click) removes the card", () => {
  expect(feed([call, verdict("ask"), result("waiting"), verdict("allow"), result("ok")])).toEqual([]);
});

test("a decline or a cancelled call removes the card", () => {
  expect(feed([call, verdict("ask"), result("declined")])).toEqual([]);
  expect(feed([call, verdict("ask"), result("cancelled")])).toEqual([]);
});

test("an allowed call never shows a card", () => {
  expect(feed([call, verdict("allow"), result("ok")])).toEqual([]);
});

test("a new chat clears the cards", () => {
  expect(feed([call, verdict("ask"), { type: "chat.started" }])).toEqual([]);
});

test("calls in plain words", () => {
  expect(describeCall("start_helper", { task: "run the tests" })).toBe("A helper: run the tests");
  expect(describeCall("remember", { text: "buy flour", title: "Shopping" })).toBe("Save a note: Shopping");
  expect(describeCall("read_file", { path: "wiki/x.md" })).toBe("Read wiki/x.md");
  expect(describeCall("some_new_tool", {})).toBe("some new tool");
});
