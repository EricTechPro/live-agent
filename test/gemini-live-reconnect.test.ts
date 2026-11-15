// The Gemini Live adapter keeps the conversation going when the server ends a
// connection (session limit, goAway, network). Driven through the agent core's
// event stream, with a fake Live server in place of the websocket.
import { describe, expect, test } from "bun:test";
import type { LiveConnectParameters, LiveServerMessage } from "@google/genai";
import { defaultConfig } from "../src/config/index.ts";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent } from "../src/core/events.ts";
import { systemInstruction } from "../src/core/tone.ts";
import { geminiLiveModel } from "../src/models/gemini-live.ts";

type FakeSocket = {
  params: LiveConnectParameters;
  sent: unknown[];
  /** The server sends a message on this socket. */
  say(message: Partial<LiveServerMessage>): void;
  /** The server hangs up. */
  drop(code?: number, reason?: string): void;
};

/** A stand-in for Google's Live server. `failAfter`: connections after this many fail. */
function fakeLive({ failAfter = Infinity } = {}) {
  const sockets: FakeSocket[] = [];
  async function connect(params: LiveConnectParameters) {
    if (sockets.length >= failAfter) throw new Error("network is down");
    let open = true;
    const socket: FakeSocket = {
      params,
      sent: [],
      say: (message) => open && params.callbacks?.onmessage?.(message as LiveServerMessage),
      drop(code = 1011, reason = "internal error") {
        if (!open) return;
        open = false;
        params.callbacks?.onclose?.({ code, reason } as CloseEvent);
      },
    };
    sockets.push(socket);
    return {
      sendRealtimeInput: (input: unknown) => void socket.sent.push(input),
      sendToolResponse: (response: unknown) => void socket.sent.push(response),
      close: () => socket.drop(1000, ""),
    };
  }
  return { sockets, connect };
}

const reply = (text: string) =>
  [{ serverContent: { outputTranscription: { text } } }, { serverContent: { turnComplete: true } }] as LiveServerMessage[];

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await Bun.sleep(5);
  expect(check()).toBe(true);
}

describe("Gemini Live connection", () => {
  test("asks for resumable sessions with context compression, so it can outlive the session limit", async () => {
    const live = fakeLive();
    const session = await startSession({ model: geminiLiveModel({ apiKey: "test", connect: live.connect }), tools: [], chatEndNote: false });

    expect(live.sockets[0]!.params.config).toEqual(
      expect.objectContaining({ sessionResumption: {}, contextWindowCompression: { slidingWindow: {} } }),
    );
    await session.close();
  });

  test("speaks with the voice named in the config", async () => {
    const live = fakeLive();
    const session = await startSession({
      model: geminiLiveModel({ apiKey: "test", connect: live.connect }),
      config: { ...defaultConfig(), voice: "Kore" },
      tools: [], chatEndNote: false,
    });

    expect(live.sockets[0]!.params.config?.speechConfig).toEqual({ voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } });
    await session.close();
  });

  test("sends the tone's system instruction (short by default)", async () => {
    const live = fakeLive();
    const session = await startSession({
      model: geminiLiveModel({ apiKey: "test", connect: live.connect }),
      config: defaultConfig(),
      tools: [], chatEndNote: false,
    });

    expect(live.sockets[0]!.params.config?.systemInstruction).toBe(systemInstruction("short"));
    await session.close();
  });

  test("when the server drops the connection, the next turn resumes the chat on a new one", async () => {
    const live = fakeLive();
    const session = await startSession({ model: geminiLiveModel({ apiKey: "test", connect: live.connect }), tools: [], chatEndNote: false });
    const seen: AgentEvent[] = [];
    session.onEvent((e) => seen.push(e));

    live.sockets[0]!.say({ sessionResumptionUpdate: { resumable: true, newHandle: "handle-1" } });
    live.sockets[0]!.drop();
    expect(seen).toContainEqual({ type: "error", message: "Gemini Live closed: 1011 internal error" });
    await until(() => live.sockets.length === 2);
    expect(live.sockets[1]!.params.config?.sessionResumption).toEqual({ handle: "handle-1" });

    const turn = session.sendText("still there?");
    await until(() => live.sockets[1]!.sent.length === 1);
    expect(live.sockets[1]!.sent).toEqual([{ text: "still there?" }]);
    reply("Yes, still here.").forEach(live.sockets[1]!.say);
    expect((await turn).at(-1)).toEqual({ type: "turn.done", reply: "Yes, still here." });
    await session.close();
  });

  test("goAway: new turns move to a new connection, the old one may finish what it was saying", async () => {
    const live = fakeLive();
    const session = await startSession({ model: geminiLiveModel({ apiKey: "test", connect: live.connect }), tools: [], chatEndNote: false });
    const seen: AgentEvent[] = [];
    session.onEvent((e) => seen.push(e));
    const old = live.sockets[0]!;

    old.say({ sessionResumptionUpdate: { resumable: true, newHandle: "handle-2" } });
    old.say({ goAway: { timeLeft: "10s" } });
    await until(() => live.sockets.length === 2);
    expect(live.sockets[1]!.params.config?.sessionResumption).toEqual({ handle: "handle-2" });
    old.drop(1000, "session over");

    const turn = session.sendText("hi");
    await until(() => live.sockets[1]!.sent.length === 1);
    reply("Hi!").forEach(live.sockets[1]!.say);
    expect((await turn).at(-1)).toEqual({ type: "turn.done", reply: "Hi!" });
    // The planned hand-over is not an error.
    expect(seen.filter((e) => e.type === "error")).toEqual([]);
    await session.close();
  });

  test("if Gemini cannot be reached again, a turn still ends instead of hanging", async () => {
    const live = fakeLive({ failAfter: 1 });
    const session = await startSession({
      model: geminiLiveModel({ apiKey: "test", connect: live.connect, retryDelaysMs: [1, 1] }),
      tools: [], chatEndNote: false,
    });
    live.sockets[0]!.drop();

    const events = await session.sendText("hello?");

    expect(events.at(-1)?.type).toBe("turn.done");
    expect(events).toContainEqual(expect.objectContaining({ type: "error", message: expect.stringContaining("network is down") }));
    await session.close();
  });
});
