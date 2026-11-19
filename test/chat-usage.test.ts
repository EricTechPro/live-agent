// The main chat's token use (the status bar): Gemini Live's usageMetadata, through the core's event stream.
import { expect, test } from "bun:test";
import type { LiveServerMessage } from "@google/genai";
import { defaultConfig } from "../src/config/index.ts";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent, EventOf } from "../src/core/events.ts";
import type { ModelEvent } from "../src/core/model.ts";
import { toModelEvents } from "../src/models/gemini-live.ts";
import { contextWindowOf, DEFAULT_LIVE_MODEL } from "../src/models/live-models.ts";
import { scriptedModel } from "../src/models/scripted.ts";

test("usageMetadata becomes a usage event, before the turn ends", () => {
  const message = {
    serverContent: { turnComplete: true },
    usageMetadata: { promptTokenCount: 900, responseTokenCount: 100, totalTokenCount: 1000 },
  } as LiveServerMessage;
  expect(toModelEvents(message)).toEqual([{ type: "usage", contextTokens: 1000 }, { type: "turn.complete" }]);
  expect(toModelEvents({ usageMetadata: { totalTokenCount: 5 } } as LiveServerMessage)).toEqual([{ type: "usage", contextTokens: 5 }]);
});

test("the live model's context window is known (Gemini 3.8 Live: 131,072 input tokens)", () => {
  expect(DEFAULT_LIVE_MODEL).toBe("gemini-3.8-live");
  expect(contextWindowOf("gemini-3.8-live")).toBe(131_072);
  expect(contextWindowOf("some-new-model")).toBeUndefined();
});

test("the chat reports the model, its context size and the tokens used so far; a new chat starts at 0", async () => {
  const usage = (contextTokens: number): ModelEvent => ({ type: "usage", contextTokens });
  const model = {
    ...scriptedModel([
      [{ type: "text", text: "Hi." }, usage(400), usage(1000)],
      [{ type: "text", text: "Sure." }, usage(1500)],
      [{ type: "text", text: "New." }, usage(200)],
    ]),
    name: "gemini-3.8-live",
  };
  const s = await startSession({ model, tools: [], mode: "bypass", config: defaultConfig(), chatEndNote: false });
  const seen: EventOf<"chat.usage">[] = [];
  s.onEvent((e: AgentEvent) => e.type === "chat.usage" && seen.push(e));

  await s.sendText("Hello.");
  await s.sendText("Again.");
  // Within a turn the latest count wins; each finished turn adds to the total.
  expect(seen.map((e) => [e.contextTokens, e.tokensUsed])).toEqual([[400, 400], [1000, 1000], [1500, 2500]]);
  expect(seen.at(-1)).toEqual({ type: "chat.usage", model: "gemini-3.8-live", contextTokens: 1500, contextWindow: 131_072, tokensUsed: 2500 });

  await s.newChat();
  await s.sendText("Fresh.");
  expect(seen.at(-1)).toMatchObject({ contextTokens: 200, tokensUsed: 200 });
  await s.close();
});
