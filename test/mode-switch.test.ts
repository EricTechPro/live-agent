// Switching the safety mode while the app runs (ticket 10), through the event stream.
// The window's dropdown and Shift+Tab both call `session.setMode`/`cycleMode`;
// the gate must use the new mode on the very next tool call.
import { describe, expect, test } from "bun:test";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent } from "../src/core/events.ts";
import { defineTool } from "../src/core/tool.ts";
import { scriptedModel } from "../src/models/scripted.ts";

const editTool = defineTool({
  name: "edit_tool",
  description: "an edit tool",
  risk: "edit",
  parameters: { type: "object", properties: {} },
  run: () => "edited",
});

const verdicts = (events: AgentEvent[]) =>
  events.flatMap((e) => (e.type === "safety.verdict" ? [`${e.mode}:${e.verdict}`] : []));

describe("switching the safety mode at runtime", () => {
  test("the gate uses the new mode on the very next tool call", async () => {
    const call = (id: string) => [{ type: "tool.call" as const, id, name: "edit_tool", args: {} }];
    const model = scriptedModel([call("c1"), [{ type: "text", text: "ok" }], call("c2"), [{ type: "text", text: "done" }]]);
    const session = await startSession({ model, tools: [editTool], mode: "auto-edits" });

    expect(verdicts(await session.sendText("edit it"))).toEqual(["auto-edits:allow"]);
    session.setMode("ask-me");
    expect(verdicts(await session.sendText("edit it again"))).toEqual(["ask-me:ask"]);
    await session.close();
  });

  test("a mode change is announced on the stream, and the session reports it", async () => {
    const session = await startSession({ model: scriptedModel([]), tools: [], mode: "auto-edits" });
    const seen: AgentEvent[] = [];
    session.onEvent((e) => seen.push(e));

    session.setMode("bypass");

    expect(seen).toEqual([{ type: "mode.changed", mode: "bypass" }]);
    expect(session.mode()).toBe("bypass");
    await session.close();
  });

  test("cycling goes Ask me -> Auto edits -> Bypass -> Ask me", async () => {
    const session = await startSession({ model: scriptedModel([]), tools: [], mode: "ask-me" });
    const seen: string[] = [];
    session.onEvent((e) => e.type === "mode.changed" && seen.push(e.mode));

    session.cycleMode();
    session.cycleMode();
    session.cycleMode();

    expect(seen).toEqual(["auto-edits", "bypass", "ask-me"]);
    await session.close();
  });
});
