// Fast tests for the agent core. They drive it the way the app does:
// start a session, send a text turn, read the events that come out.
// The model is a scripted fake, so these run with no network and no key.
import { describe, expect, test } from "bun:test";
import { startSession } from "../src/core/agent.ts";
import { scriptedModel } from "../src/models/scripted.ts";

describe("text turn through the agent core", () => {
  test("a text turn returns transcript events for the reply", async () => {
    const model = scriptedModel([
      [{ type: "text", text: "Hello, " }, { type: "text", text: "Eric." }],
    ]);
    const session = await startSession({ model });

    const events = await session.sendText("hi there");

    expect(events).toEqual([
      { type: "transcript", role: "user", text: "hi there" },
      { type: "transcript", role: "model", text: "Hello, " },
      { type: "transcript", role: "model", text: "Eric." },
      { type: "turn.done", reply: "Hello, Eric." },
    ]);
    await session.close();
  });

  test("a listener sees every event of every turn, in order", async () => {
    const model = scriptedModel([[{ type: "text", text: "One." }], [{ type: "text", text: "Two." }]]);
    const session = await startSession({ model });
    const seen: string[] = [];
    session.onEvent((e) => seen.push(e.type === "transcript" ? `${e.role}:${e.text}` : e.type));

    await session.sendText("first");
    await session.sendText("second");

    expect(seen).toEqual([
      "user:first", "model:One.", "turn.done",
      "user:second", "model:Two.", "turn.done",
    ]);
    await session.close();
  });

  test("a model error shows up on the stream and the turn still ends", async () => {
    const session = await startSession({ model: scriptedModel([]) });

    const events = await session.sendText("anyone there?");

    expect(events.map((e) => e.type)).toEqual(["transcript", "error", "turn.done"]);
    await session.close();
  });
});
