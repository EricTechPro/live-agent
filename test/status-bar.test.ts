// The panel's status bar (model, context bar, tokens used) and the Agents view's token counts.
import { expect, test } from "bun:test";
import { addJobEvent, emptyBoard } from "../app/src/job-board.ts";
import { addStatusEvent, contextPercent, formatTokens, startStatus } from "../app/src/status-bar.ts";
import type { AgentEvent } from "../src/core/events.ts";

const status = (events: AgentEvent[]) => events.reduce(addStatusEvent, startStatus);

test("before any reply it shows the default live model, an empty context and 0 tokens", () => {
  expect(startStatus).toEqual({ model: "gemini-3.8-live", contextTokens: 0, contextWindow: 131_072, tokensUsed: 0 });
  expect(contextPercent(startStatus)).toBe(0);
});

test("chat.usage fills it in; a new chat empties the counts", () => {
  const s = status([{ type: "chat.usage", model: "gemini-3.8-live", contextTokens: 65_536, contextWindow: 131_072, tokensUsed: 90_000 }]);
  expect(s).toMatchObject({ contextTokens: 65_536, tokensUsed: 90_000 });
  expect(contextPercent(s)).toBe(50);
  expect(status([{ type: "chat.usage", contextTokens: 10, tokensUsed: 10 }, { type: "chat.started" }])).toMatchObject({
    contextTokens: 0, tokensUsed: 0,
  });
});

test("a model with an unknown window has no percent; a full context caps at 100", () => {
  expect(contextPercent(status([{ type: "chat.usage", model: "new-live", contextTokens: 5, tokensUsed: 5 }]))).toBeUndefined();
  expect(contextPercent({ ...startStatus, contextTokens: 999_999 })).toBe(100);
});

test("token counts read short", () => {
  expect([0, 950, 1234, 131_072, 1_500_000].map(formatTokens)).toEqual(["0", "950", "1.2k", "131k", "1.5M"]);
});

test("each agent row carries the tokens its helper used", () => {
  const rows = [
    { type: "job.state", id: "job-1", kind: "codex", title: "find the Linear MCP server", state: "done", tokens: 1234 },
  ].reduce((b, e) => addJobEvent(b, e as AgentEvent), emptyBoard);
  expect(rows[0]).toMatchObject({ helperLabel: "Codex", status: "done", tokens: 1234 });
});
