// Esc stops a reply (ticket 37): Jett's voice stops at once, the rest of that reply is
// dropped, `interrupted` goes on the stream, and the next thing you say plays again.
import { expect, test } from "bun:test";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent } from "../src/core/events.ts";
import type { ModelEvent } from "../src/core/model.ts";
import { scriptedModel } from "../src/models/scripted.ts";

const VOICE = new Int16Array([1, 2, 3, 4]);

test("stopping a reply drops its voice until you speak again; the mic stays on", async () => {
  const mic: number[] = [];
  let push: ((e: ModelEvent) => void) | undefined;
  const inner = scriptedModel([[{ type: "text", text: "Hi." }]]);
  const session = await startSession({
    tools: [],
    model: {
      async connect(onEvent, options) {
        push = onEvent;
        const s = await inner.connect(onEvent, options);
        return { ...s, sendAudio: (d) => mic.push(d.length) };
      },
    },
  });
  const events: AgentEvent[] = [];
  const audio: string[] = [];
  session.onEvent((e) => events.push(e));
  session.onAudio((out) => audio.push(out.type));
  await session.sendText("hello");

  push!({ type: "audio", data: VOICE, sampleRate: 24000 });
  session.stopReply();
  push!({ type: "audio", data: VOICE, sampleRate: 24000 }); // the rest of the reply, arriving late
  expect(audio.filter((a) => a !== "clear")).toHaveLength(1);
  expect(audio.at(-1)).toBe("clear");
  expect(events.at(-1)).toEqual({ type: "interrupted" });

  session.sendAudio(new Int16Array(160), 16000);
  expect(mic).toEqual([160]); // not a pause: the mic still goes to Jett
  expect(session.paused()).toBe(false);

  push!({ type: "user.text", text: "and tomorrow?" });
  push!({ type: "audio", data: VOICE, sampleRate: 24000 });
  expect(audio.filter((a) => a !== "clear")).toHaveLength(2);
  await session.close();
});
