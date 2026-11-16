// Ticket 40: a network or DNS failure (Mac asleep, Wi-Fi gone) never kills the core.
// The Gemini Live adapter keeps retrying with backoff and says so on the event stream
// (`connection` events); an idle 1008 close waits for the next input; a stale resume
// handle is dropped; a dial that lands after close() is hung up.
import { describe, expect, test } from "bun:test";
import type { LiveConnectParameters, LiveServerMessage } from "@google/genai";
import { startSession } from "../src/core/agent.ts";
import type { AgentEvent } from "../src/core/events.ts";
import { geminiLiveModel, isNetworkError, networkRetryDelay } from "../src/models/gemini-live.ts";

type FakeSocket = {
  params: LiveConnectParameters;
  sent: unknown[];
  closed: boolean;
  say(message: Partial<LiveServerMessage>): void;
  drop(code?: number, reason?: string): void;
};

/** A fake Live server. `down` makes every dial fail like a dead DNS until set false. */
function fakeLive() {
  const sockets: FakeSocket[] = [];
  const state = { down: false, dials: 0, hold: undefined as Promise<void> | undefined };
  async function connect(params: LiveConnectParameters) {
    state.dials++;
    if (state.hold) await state.hold;
    if (state.down) throw new Error("getaddrinfo ENOTFOUND generativelanguage.googleapis.com");
    const socket: FakeSocket = {
      params,
      sent: [],
      closed: false,
      say: (message) => !socket.closed && params.callbacks?.onmessage?.(message as LiveServerMessage),
      drop(code = 1011, reason = "internal error") {
        if (socket.closed) return;
        socket.closed = true;
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
  return { sockets, connect, state };
}

async function until(check: () => boolean) {
  for (let i = 0; i < 400 && !check(); i++) await Bun.sleep(5);
  expect(check()).toBe(true);
}

describe("network errors", () => {
  test("DNS, refused, reset, timeout and fetch failures count as network; a bad key does not", () => {
    for (const m of [
      "getaddrinfo ENOTFOUND generativelanguage.googleapis.com",
      "connect ECONNREFUSED 1.2.3.4:443",
      "read ECONNRESET",
      "ETIMEDOUT",
      "getaddrinfo EAI_AGAIN x",
      "fetch failed",
      "Unable to connect. Is the computer able to access the url?",
      "connect ENETUNREACH",
    ]) expect(isNetworkError(new Error(m))).toBe(true);
    expect(isNetworkError(Object.assign(new Error("x"), { code: "ENOTFOUND" }))).toBe(true);
    expect(isNetworkError(new Error("API key not valid"))).toBe(false);
    expect(isNetworkError(new Error("network is down"))).toBe(false);
  });

  test("backoff is 1 s, 2 s, 5 s, 10 s, then every 30 s", () => {
    expect([0, 1, 2, 3, 4, 5, 50].map((n) => networkRetryDelay(n))).toEqual([1000, 2000, 5000, 10000, 30000, 30000, 30000]);
  });
});

describe("Gemini Live with the network down", () => {
  test("no network at start: the session still starts, says it is reconnecting, and connects when the network is back", async () => {
    const live = fakeLive();
    live.state.down = true;
    const model = geminiLiveModel({ apiKey: "test", connect: live.connect, networkDelaysMs: [5, 5] });
    const session = await startSession({ model, tools: [], chatEndNote: false });
    const seen: AgentEvent[] = [];
    session.onEvent((e) => seen.push(e));

    await until(() => seen.some((e) => e.type === "connection" && e.state === "reconnecting"));
    const first = seen.find((e) => e.type === "connection")!;
    expect(first).toEqual(expect.objectContaining({ type: "connection", state: "reconnecting", retryInMs: 5 }));
    // A typed turn while offline ends at once with a plain reason, it does not hang.
    const events = await session.sendText("hello?");
    expect(events.at(-1)?.type).toBe("turn.done");
    expect(events).toContainEqual(expect.objectContaining({ type: "error", message: expect.stringContaining("reconnecting") }));

    live.state.down = false;
    await until(() => live.sockets.length === 1);
    await until(() => seen.some((e) => e.type === "connection" && e.state === "connected"));
    await session.close();
  });

  test("Retry (reconnectNow) cuts a long backoff wait short", async () => {
    const live = fakeLive();
    live.state.down = true;
    const model = geminiLiveModel({ apiKey: "test", connect: live.connect, networkDelaysMs: [60_000] });
    const session = await startSession({ model, tools: [], chatEndNote: false });
    await until(() => live.state.dials === 2); // the first try and the first retry: now waiting a minute
    await Bun.sleep(5);
    live.state.down = false;
    session.reconnectNow();
    await until(() => live.sockets.length === 1);
    await session.close();
  });

  test("keeps retrying past the old three tries while the network stays down", async () => {
    const live = fakeLive();
    const model = geminiLiveModel({ apiKey: "test", connect: live.connect, networkDelaysMs: [1], retryDelaysMs: [1] });
    const session = await startSession({ model, tools: [], chatEndNote: false });
    live.state.down = true;
    live.sockets[0]!.drop();
    await until(() => live.state.dials > 8);
    live.state.down = false;
    await until(() => live.sockets.length === 2);
    await session.close();
  });

  test("1008 client inactivity: no reconnect storm and no error; the next turn reconnects", async () => {
    const live = fakeLive();
    const session = await startSession({ model: geminiLiveModel({ apiKey: "test", connect: live.connect }), tools: [], chatEndNote: false });
    const seen: AgentEvent[] = [];
    session.onEvent((e) => seen.push(e));

    live.sockets[0]!.drop(1008, "Session closed due to client inactivity");
    await Bun.sleep(30);
    expect(live.state.dials).toBe(1);
    expect(seen.filter((e) => e.type === "error")).toEqual([]);

    const turn = session.sendText("back");
    await until(() => live.sockets.length === 2 && live.sockets[1]!.sent.length === 1);
    live.sockets[1]!.say({ serverContent: { outputTranscription: { text: "hi" } } });
    live.sockets[1]!.say({ serverContent: { turnComplete: true } });
    expect((await turn).at(-1)).toEqual({ type: "turn.done", reply: "hi" });
    await session.close();
  });

  test("mic audio after an idle close reconnects too (the audio itself is dropped, it is old)", async () => {
    const live = fakeLive();
    const session = await startSession({ model: geminiLiveModel({ apiKey: "test", connect: live.connect }), tools: [], chatEndNote: false });
    live.sockets[0]!.drop(1008, "Session closed due to client inactivity");
    session.sendAudio(new Int16Array(160), 16000);
    await until(() => live.sockets.length === 2);
    await session.close();
  });

  test("a stale resume handle (not found / already exists) is dropped, so the next connection starts fresh", async () => {
    const live = fakeLive();
    const session = await startSession({ model: geminiLiveModel({ apiKey: "test", connect: live.connect }), tools: [], chatEndNote: false });
    live.sockets[0]!.say({ sessionResumptionUpdate: { resumable: true, newHandle: "h1" } });
    live.sockets[0]!.drop(1011, "internal error");
    await until(() => live.sockets.length === 2);
    expect(live.sockets[1]!.params.config?.sessionResumption).toEqual({ handle: "h1" });
    await Bun.sleep(10); // let the second dial finish opening before it drops
    live.sockets[1]!.drop(1008, "Requested entity already exists");
    await until(() => live.sockets.length === 3);
    expect(live.sockets[2]!.params.config?.sessionResumption).toEqual({});
    await session.close();
  });

  test("a connection that opens after close() is hung up, not left running", async () => {
    const live = fakeLive();
    const session = await startSession({ model: geminiLiveModel({ apiKey: "test", connect: live.connect }), tools: [], chatEndNote: false });
    let release = () => {};
    live.state.hold = new Promise((r) => (release = r));
    live.sockets[0]!.drop();
    await until(() => live.state.dials === 2);
    await session.close();
    live.state.hold = undefined;
    release();
    await until(() => live.sockets.length === 2);
    await until(() => live.sockets[1]!.closed);
  });
});
