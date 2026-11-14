// Gemini Live can take back tool calls (toolCallCancellation), e.g. when the
// user talks over the model before the tool has answered. Through the agent
// core's event stream: the call shows as cancelled, and the model never gets an
// answer for a call it dropped.
import { describe, expect, test } from "bun:test";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent } from "../src/core/events.ts";
import type { ModelInput } from "../src/core/model.ts";
import { defineTool } from "../src/core/tool.ts";
import { scriptedModel } from "../src/models/scripted.ts";

describe("the model cancels a tool call", () => {
  test("a call waiting for a yes is dropped: it shows cancelled, and a later yes runs nothing", async () => {
    let runs = 0;
    const edit = defineTool({
      name: "edit_note",
      description: "an edit",
      risk: "edit",
      parameters: { type: "object", properties: {} },
      run: () => ({ ran: ++runs }),
    });
    const session = await startSession({
      model: scriptedModel([
        [{ type: "tool.call", id: "c1", name: "edit_note", args: {} }],
        [{ type: "text", text: "May I?" }, { type: "tool.cancel", ids: ["c1"] }],
        [{ type: "text", text: "Yes to what?" }],
      ]),
      tools: [edit],
      mode: "ask-me",
      chatEndNote: false,
    });

    const first = await session.sendText("edit my note");
    expect(first).toContainEqual({ type: "tool.result", id: "c1", name: "edit_note", status: "cancelled" });

    const yes = await session.sendText("yes");
    expect(runs).toBe(0);
    expect(yes.at(-1)).toEqual({ type: "turn.done", reply: "Yes to what?" });
    await session.close();
  });

  test("a running call's answer never reaches the model once it was cancelled", async () => {
    let finish!: () => void;
    const slow = defineTool({
      name: "slow_read",
      description: "a slow read",
      risk: "read",
      parameters: { type: "object", properties: {} },
      run: () => new Promise((resolve) => (finish = () => resolve({ ok: true }))),
    });
    const inputs: ModelInput["type"][] = [];
    const session = await startSession({
      model: scriptedModel([
        [{ type: "tool.call", id: "c1", name: "slow_read", args: {} }, { type: "tool.cancel", ids: ["c1"] }],
        (input) => (inputs.push(input.type), [{ type: "text", text: "Next." }]),
      ]),
      tools: [slow],
      chatEndNote: false,
    });
    const seen: AgentEvent[] = [];
    session.onEvent((e) => seen.push(e));

    const turn = session.sendText("read it");
    await Bun.sleep(5);
    finish();
    await turn;

    expect(seen.filter((e) => e.type === "tool.result")).toEqual([
      { type: "tool.result", id: "c1", name: "slow_read", status: "cancelled" },
    ]);
    const next = await session.sendText("and now?");
    expect(inputs).toEqual(["text"]); // the next entry answered the user, not a late tool answer
    expect(next.at(-1)).toEqual({ type: "turn.done", reply: "Next." });
    await session.close();
  });
});
