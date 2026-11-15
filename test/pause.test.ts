// Pause (the window's Pause button and Space): Jett stops speaking at once and
// stops hearing the mic, but the chat and its transcript stay. Resume carries on.
import { expect, test } from "bun:test";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent } from "../src/core/events.ts";
import type { ModelEvent } from "../src/core/model.ts";
import { scriptedModel } from "../src/models/scripted.ts";

const MIC_CHUNK = new Int16Array(160);
const VOICE = new Int16Array([1, 2, 3, 4]);

test("pause drops Jett's voice and the mic; resume continues the same chat", async () => {
  const mic: number[] = [];
  let push: ((e: ModelEvent) => void) | undefined;
  const inner = scriptedModel([[{ type: "text", text: "Hi." }], [{ type: "text", text: "Still here." }]]);
  const session = await startSession({
    tools: [],
    model: {
      async connect(onEvent, options) {
        push = onEvent;
        const s = await inner.connect(onEvent, options);
        return { ...s, sendAudio: (d, r) => mic.push(d.length) };
      },
    },
  });
  const events: AgentEvent[] = [];
  const audio: string[] = [];
  session.onEvent((e) => events.push(e));
  session.onAudio((out) => audio.push(out.type));

  await session.sendText("hello");
  session.setPaused(true);
  expect(session.paused()).toBe(true);
  expect(audio).toEqual(["clear"]); // whatever was playing stops now
  push!({ type: "audio", data: VOICE, sampleRate: 24000 }); // the rest of a sentence, arriving late
  session.sendAudio(MIC_CHUNK, 16000);
  expect(audio).toEqual(["clear"]);
  expect(mic).toEqual([]);

  session.setPaused(false);
  session.sendAudio(MIC_CHUNK, 16000);
  expect(mic).toEqual([160]);
  const next = await session.sendText("you there?");
  expect(next.at(-1)).toEqual({ type: "turn.done", reply: "Still here." });
  expect(events.filter((e) => e.type === "paused")).toEqual([
    { type: "paused", paused: true },
    { type: "paused", paused: false },
  ]);
  expect(events.some((e) => e.type === "chat.started")).toBe(false); // same chat
  await session.close();
});
