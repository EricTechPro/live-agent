// The cues next to the orb (ticket 37): equaliser pill, working pill, speech bubble,
// and the caption bar while a drawing is on screen.
import { expect, test } from "bun:test";
import { actionLabel, addWork, BUBBLE_FOLD, cuesFor, drawsOnCanvas, noWork, type Work } from "../app/src/cues.ts";
import type { AgentEvent } from "../src/core/events.ts";

const call = (id: string, name: string, args: Record<string, unknown> = {}): AgentEvent => ({ type: "tool.call", id, name, args });
const result = (id: string, status: "ok" | "waiting" | "error"): AgentEvent => ({ type: "tool.result", id, name: "x", status });
const run = (events: AgentEvent[], from: Work = noWork) => events.reduce((w, e) => addWork(w, e), from);

test("actions read as plain words, in English and Chinese", () => {
  expect(actionLabel("start_helper", { helper: "claude-code", task: "fix it" })).toBe("Asking Claude Code…");
  expect(actionLabel("search_brain", { query: "gus" })).toBe("Searching your notes…");
  expect(actionLabel("read_file", { path: "wiki/sourdough.md" })).toBe("Reading sourdough.md…");
  expect(actionLabel("remember", {})).toBe("Saving a note…");
  expect(actionLabel("some_new_tool", {})).toBe("some new tool…");
  expect(actionLabel("start_helper", { helper: "codex" }, "zh")).toBe("在请 Codex 帮忙…");
  expect(actionLabel("search_brain", {}, "zh")).toBe("在查你的笔记…");
});

test("the working pill names the latest running call and clears when it is done", () => {
  const w = run([call("a", "search_brain"), call("b", "start_helper", { helper: "codex" })]);
  expect(w.running.at(-1)?.label).toBe("Asking Codex…");
  expect(run([result("b", "ok")], w).running.map((r) => r.id)).toEqual(["a"]);
  expect(run([result("a", "waiting")], w)).toBe(w); // still waiting for a yes: still working
  expect(run([{ type: "turn.done", reply: "" } as AgentEvent], w)).toEqual(noWork);
});

test("listening: the equaliser pill with your words", () => {
  expect(cuesFor({ look: "listening", caption: { user: "what's on" }, drawing: false })).toEqual({
    pill: { kind: "listen", text: "what's on" },
    bar: false,
  });
});

test("working: the spinner pill names the action, over the listening pill", () => {
  expect(cuesFor({ look: "thinking", working: "Asking Claude Code…", caption: {}, drawing: false }).pill).toEqual({ kind: "work", text: "Asking Claude Code…" });
  expect(cuesFor({ look: "listening", working: "Reading x…", caption: {}, drawing: false }).pill?.kind).toBe("work");
});

test("speaking: a bubble with Jett's words; a long reply folds", () => {
  expect(cuesFor({ look: "speaking", caption: { model: "Three things." }, drawing: false }).bubble).toEqual({ text: "Three things.", long: false });
  const long = "x".repeat(BUBBLE_FOLD + 1);
  expect(cuesFor({ look: "speaking", caption: { model: long }, drawing: false }).bubble?.long).toBe(true);
});

test("idle: nothing, unless Jett just said something", () => {
  expect(cuesFor({ look: "idle", caption: {}, drawing: false })).toEqual({ bar: false });
  expect(cuesFor({ look: "idle", caption: { model: "Hi! I'm Jett." }, drawing: false }).bubble?.text).toBe("Hi! I'm Jett.");
});

test("a drawing on screen: the words go to the bottom caption bar, no bubble", () => {
  const c = cuesFor({ look: "speaking", caption: { user: "draw it", model: "Here is the flow." }, drawing: true });
  expect(c.bubble).toBeUndefined();
  expect(c.bar).toBe(true);
  expect(cuesFor({ look: "listening", caption: { user: "hm" }, drawing: true }).pill).toEqual({ kind: "listen" });
});

test("only canvas events show the drawing", () => {
  expect(drawsOnCanvas({ type: "canvas.beat" })).toBe(true);
  expect(drawsOnCanvas({ type: "job.state" })).toBe(false);
});
