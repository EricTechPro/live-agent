// The voice bridge, over a real local LiveKit server: a stand-in for the window
// joins the room as "user" and publishes a mic track; the core joins as
// "agent". The model is a hand-driven fake, so the test decides when it speaks.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
} from "@livekit/rtc-node";
import { startSession, type AgentSession } from "../src/core/agent.ts";
import type { AgentEvent } from "../src/core/events.ts";
import type { Model, ModelEvent } from "../src/core/model.ts";
import { joinVoiceRoom } from "../src/voice/livekit-bridge.ts";
import { startLiveKit, type LiveKitServer } from "../src/voice/livekit-runner.ts";
import { createTokenService, type TokenService } from "../src/voice/token-service.ts";

const PORT = 7940;
const ROOM = "live-agent";

/** A fake model the test drives by hand: `say` an event, see if mic audio arrived. */
function handModel() {
  let emit: (e: ModelEvent) => void = () => {};
  let micSamples = 0;
  const model: Model = {
    async connect(onEvent) {
      emit = onEvent;
      return {
        sendText() {},
        sendAudio(data) {
          micSamples += data.length;
        },
        sendToolResponse() {},
        async close() {},
      };
    },
  };
  return { model, say: (e: ModelEvent) => emit(e), micSamples: () => micSamples };
}

/** The window, played by rtc-node: joins as "user", publishes a mic, counts what it hears. */
async function fakeWindow(lk: LiveKitServer, tokens: TokenService) {
  const room = new Room();
  let heard = 0;
  room.on(RoomEvent.TrackSubscribed, async (track, _pub, participant) => {
    if (track.kind !== TrackKind.KIND_AUDIO || participant.identity !== "agent") return;
    for await (const frame of new AudioStream(track, { sampleRate: 24000, numChannels: 1 })) {
      // Count only real sound: WebRTC fills gaps with silence.
      if (frame.data.some((s) => s !== 0)) heard += frame.samplesPerChannel;
    }
  });
  await room.connect(lk.url, (await tokens.livekitToken("user")).token, { autoSubscribe: true, dynacast: false });
  const mic = new AudioSource(16000, 1);
  const options = new TrackPublishOptions();
  options.source = TrackSource.SOURCE_MICROPHONE;
  await room.localParticipant!.publishTrack(LocalAudioTrack.createAudioTrack("mic", mic), options);
  let talking = true;
  (async () => {
    const pcm = new Int16Array(160).map((_, i) => Math.sin(i / 3) * 6000);
    while (talking) await mic.captureFrame(new AudioFrame(pcm, 16000, 1, 160));
  })();
  return {
    heardSeconds: () => heard / 24000,
    async leave() {
      talking = false;
      await room.disconnect();
    },
  };
}

async function until(check: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await Bun.sleep(20);
  }
}

/** `seconds` of a 440 Hz tone at 24 kHz, like Gemini's voice. */
function tone(seconds: number) {
  return new Int16Array(24000 * seconds).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / 24000) * 8000);
}

let lk: LiveKitServer;
let tokens: TokenService;
beforeAll(async () => {
  lk = await startLiveKit({ port: PORT });
  tokens = createTokenService({ livekit: lk, room: ROOM });
});
afterAll(() => lk.stop());

async function setup() {
  const fake = handModel();
  const session: AgentSession = await startSession({ model: fake.model, tools: [] });
  const events: AgentEvent[] = [];
  session.onEvent((e) => events.push(e));
  const bridge = await joinVoiceRoom({ session, url: lk.url, token: (await tokens.livekitToken("agent")).token });
  const window = await fakeWindow(lk, tokens);
  return { fake, session, events, bridge, window };
}

describe("voice over local LiveKit", () => {
  test("the user's mic reaches the model, and the model's voice reaches the user", async () => {
    const { fake, events, bridge, window } = await setup();

    await until(() => fake.micSamples() > 16000 * 0.2); // 200 ms of mic got through
    fake.say({ type: "user.text", text: "hello" });
    fake.say({ type: "text", text: "Hi there." });
    fake.say({ type: "audio", data: tone(0.5), sampleRate: 24000 });
    fake.say({ type: "turn.complete" });

    await until(() => window.heardSeconds() > 0.3);
    expect(events).toEqual([
      { type: "transcript", role: "user", text: "hello" },
      { type: "transcript", role: "model", text: "Hi there." },
      { type: "turn.done", reply: "Hi there." },
    ]);
    await window.leave();
    await bridge.close();
  }, 15_000);

  test("interrupting drops the rest of the model's voice", async () => {
    const { fake, events, bridge, window } = await setup();
    await until(() => fake.micSamples() > 0);

    fake.say({ type: "user.text", text: "tell me everything" });
    fake.say({ type: "audio", data: tone(4), sampleRate: 24000 }); // a 4 second answer
    await until(() => window.heardSeconds() > 0.3);
    fake.say({ type: "interrupted" });
    fake.say({ type: "turn.complete" });
    const atInterrupt = window.heardSeconds();

    await Bun.sleep(1500);
    // Without the interrupt the user would keep hearing it for ~3.5 more seconds.
    expect(window.heardSeconds() - atInterrupt).toBeLessThan(0.5);
    expect(events.map((e) => e.type)).toContain("interrupted");
    await window.leave();
    await bridge.close();
  }, 15_000);
});
