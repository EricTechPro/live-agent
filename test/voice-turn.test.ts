// Voice turns through the agent core, with a scripted fake model.
// The point: a spoken turn puts the same events on the stream as a text turn,
// and the model's voice comes out on a separate audio channel.
import { describe, expect, test } from "bun:test";
import { startSession, type AgentSession } from "../src/core/agent.ts";
import type { AgentEvent } from "../src/core/events.ts";
import { scriptedModel } from "../src/models/scripted.ts";

const MIC_CHUNK = new Int16Array(160); // 10 ms of 16 kHz silence: content does not matter to the fake
const VOICE = new Int16Array([1, 2, 3, 4]);

/** Collect stream events until the next `turn.done`. */
function nextTurn(session: AgentSession): Promise<AgentEvent[]> {
  return new Promise((resolve) => {
    const events: AgentEvent[] = [];
    const off = session.onEvent((e) => {
      events.push(e);
      if (e.type === "turn.done") {
        off();
        resolve(events);
      }
    });
  });
}

describe("voice turn through the agent core", () => {
  test("a spoken turn produces the same events as a text turn", async () => {
    const reply = [{ type: "text", text: "Hello, " }, { type: "text", text: "Eric." }] as const;
    const textSession = await startSession({ model: scriptedModel([[...reply]]), tools: [] });
    const voiceSession = await startSession({
      model: scriptedModel([[{ type: "user.text", text: "hi there" }, ...reply]]),
      tools: [],
    });

    const textEvents = await textSession.sendText("hi there");
    const voiceTurn = nextTurn(voiceSession);
    voiceSession.sendAudio(MIC_CHUNK, 16000);
    const voiceEvents = await voiceTurn;

    expect(voiceEvents).toEqual(textEvents);
    await textSession.close();
    await voiceSession.close();
  });

  test("the model's voice comes out on the audio channel, not the event stream", async () => {
    const session = await startSession({
      model: scriptedModel([
        [{ type: "user.text", text: "say something" }, { type: "audio", data: VOICE, sampleRate: 24000 }],
      ]),
      tools: [],
    });
    const heard: unknown[] = [];
    session.onAudio((out) => heard.push(out));

    const turn = nextTurn(session);
    session.sendAudio(MIC_CHUNK, 16000);
    const events = await turn;

    expect(heard).toEqual([{ type: "audio", data: VOICE, sampleRate: 24000 }]);
    expect(events.map((e) => e.type)).toEqual(["transcript", "turn.done"]);
    await session.close();
  });

  test("talking over the model interrupts it: the stream says so and queued voice is dropped", async () => {
    const session = await startSession({
      model: scriptedModel([
        [
          { type: "user.text", text: "tell me a long story" },
          { type: "text", text: "Once upon a" },
          { type: "audio", data: VOICE, sampleRate: 24000 },
          { type: "interrupted" },
          { type: "turn.complete" },
        ],
        [{ type: "user.text", text: "stop" }, { type: "text", text: "Okay." }],
      ]),
      tools: [],
    });
    const heard: string[] = [];
    session.onAudio((out) => heard.push(out.type));

    const first = nextTurn(session);
    session.sendAudio(MIC_CHUNK, 16000);
    expect(await first).toEqual([
      { type: "transcript", role: "user", text: "tell me a long story" },
      { type: "transcript", role: "model", text: "Once upon a" },
      { type: "interrupted" },
      { type: "turn.done", reply: "Once upon a" },
    ]);
    expect(heard).toEqual(["audio", "clear"]);

    // The user's new words are the next turn.
    const second = nextTurn(session);
    session.sendAudio(MIC_CHUNK, 16000);
    expect((await second).at(-1)).toEqual({ type: "turn.done", reply: "Okay." });
    await session.close();
  });
});
