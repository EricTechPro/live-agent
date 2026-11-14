// When the live connection drops (server session limit, network, token expiry),
// the model adapter reconnects on its own and says `disconnected` once. These
// tests check the core's half through the event stream: a dropped connection
// never leaves a turn hanging, and nothing from the dead connection leaks into
// the next one.
import { describe, expect, test } from "bun:test";
import { startSession } from "../src/core/agent.ts";
import type { ModelInput } from "../src/core/model.ts";
import { defineTool } from "../src/core/tool.ts";
import { scriptedModel } from "../src/models/scripted.ts";

const DROP = { type: "disconnected", message: "Gemini Live closed: 1011 internal error" } as const;

describe("a dropped live connection", () => {
  test("ends the turn in flight with an error, and the next turn works", async () => {
    const session = await startSession({
      model: scriptedModel([[{ type: "text", text: "Let me th" }, DROP], [{ type: "text", text: "Back again." }]]),
      tools: [],
    });

    const first = await session.sendText("hello?");
    expect(first).toEqual([
      { type: "transcript", role: "user", text: "hello?" },
      { type: "transcript", role: "model", text: "Let me th" },
      { type: "error", message: DROP.message },
      { type: "turn.done", reply: "Let me th" },
    ]);

    const second = await session.sendText("still there?");
    expect(second.at(-1)).toEqual({ type: "turn.done", reply: "Back again." });
    await session.close();
  });

  test("a tool still running when it drops neither holds the turn nor answers the new connection", async () => {
    let finish!: () => void;
    const slow = defineTool({
      name: "slow_read",
      description: "a slow read",
      risk: "read",
      parameters: { type: "object", properties: {} },
      run: () => new Promise((resolve) => (finish = () => resolve({ ok: true }))),
    });
    const inputs: ModelInput["type"][] = [];
    const script = scriptedModel([
      [{ type: "tool.call", id: "c1", name: "slow_read", args: {} }, DROP],
      [{ type: "text", text: "Back again." }],
    ]);
    // Record what reaches the model.
    const model = {
      async connect(...args: Parameters<typeof script.connect>) {
        const inner = await script.connect(...args);
        return {
          ...inner,
          sendText: (text: string) => (inputs.push("text"), inner.sendText(text)),
          sendToolResponse: (r: Parameters<typeof inner.sendToolResponse>[0]) => (inputs.push("tool.response"), inner.sendToolResponse(r)),
        };
      },
    };
    const session = await startSession({ model, tools: [slow] });
    const events: string[] = [];
    session.onEvent((e) => events.push(e.type));

    const first = await session.sendText("read it slowly");
    expect(first.at(-1)?.type).toBe("turn.done");

    finish();
    await Bun.sleep(10);
    // The result still shows in the app, but the new connection never hears about c1.
    expect(events).toContain("tool.result");
    expect(inputs).toEqual(["text"]);

    const second = await session.sendText("anyone?");
    expect(second.at(-1)).toEqual({ type: "turn.done", reply: "Back again." });
    await session.close();
  });

  test("a call waiting for a yes is dropped with the connection: a later yes runs nothing", async () => {
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
        [{ type: "text", text: "May I edit it?" }, DROP],
        [{ type: "text", text: "Yes to what?" }],
      ]),
      tools: [edit],
      mode: "ask-me",
    });

    await session.sendText("edit my note");
    const yes = await session.sendText("yes");

    expect(runs).toBe(0);
    expect(yes.at(-1)).toEqual({ type: "turn.done", reply: "Yes to what?" });
    await session.close();
  });
});
