// The voice bridge: puts the agent core into the local LiveKit room.
//
//   const bridge = await joinVoiceRoom({ session, url: lk.url, token });  // token for identity "agent"
//   ...
//   await bridge.close();
//
//   window (identity "user") --mic--> LiveKit --> here --16 kHz PCM--> session.sendAudio
//   window <--"agent-voice" track-- LiveKit <-- here <--24 kHz PCM-- session.onAudio
//
// Why our own bridge (not LiveKit Agents JS): Agents JS forks worker .js files
// that do not exist inside a `bun build --compile` binary, weighs ~130 MB, and
// owns the tool loop. @livekit/rtc-node is a plain native addon that runs
// under Bun (tested) and embeds into the compiled sidecar. So the voice worker
// is the core process itself, on Bun; no Node needed.
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
import type { AgentSession } from "../core/agent.ts";

export interface VoiceRoomOptions {
  session: AgentSession;
  url: string;
  /** A LiveKit token for the agent's own identity (e.g. "agent"). */
  token: string;
  /** Whose mic to listen to. Default "user". */
  userIdentity?: string;
}

export interface VoiceRoom {
  close(): Promise<void>;
}

const MIC_RATE = 16000; // what Gemini Live wants in
const VOICE_RATE = 24000; // what Gemini Live speaks
const FRAME = VOICE_RATE / 50; // 20 ms frames

export async function joinVoiceRoom(options: VoiceRoomOptions): Promise<VoiceRoom> {
  const { session } = options;
  const userIdentity = options.userIdentity ?? "user";
  const room = new Room();
  let closed = false;

  // The user's mic: rtc-node resamples to 16 kHz mono for us.
  room.on(RoomEvent.TrackSubscribed, async (track, _publication, participant) => {
    if (track.kind !== TrackKind.KIND_AUDIO || participant.identity !== userIdentity) return;
    for await (const frame of new AudioStream(track, { sampleRate: MIC_RATE, numChannels: 1 })) {
      if (closed) break;
      session.sendAudio(frame.data, MIC_RATE);
    }
  });

  await room.connect(options.url, options.token, { autoSubscribe: true, dynacast: false });

  const voice = new AudioSource(VOICE_RATE, 1);
  const publish = new TrackPublishOptions();
  publish.source = TrackSource.SOURCE_MICROPHONE;
  await room.localParticipant!.publishTrack(LocalAudioTrack.createAudioTrack("agent-voice", voice), publish);

  // The model sends voice faster than real time; AudioSource only buffers ~1 s,
  // so the rest waits here. `generation` bumps on every interrupt, so a frame
  // loop that started before it stops at its next frame.
  let pending: Int16Array[] = [];
  let generation = 0;
  let pumping = false;

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (pending.length && !closed) {
        const chunk = pending.shift()!;
        const mine = generation;
        for (let i = 0; i < chunk.length; i += FRAME) {
          if (mine !== generation || closed) break;
          // slice, not subarray: AudioFrame hands native code `data.buffer` and
          // ignores the view's offset, so a subarray would replay the chunk's
          // first 20 ms for every frame (a buzzing, robotic voice).
          const data = chunk.slice(i, i + FRAME);
          await voice.captureFrame(new AudioFrame(data, VOICE_RATE, 1, data.length));
        }
      }
    } finally {
      pumping = false;
    }
  }

  const offAudio = session.onAudio((out) => {
    if (out.type === "clear") {
      // Barge-in: drop everything not yet played, right now.
      pending = [];
      generation++;
      voice.clearQueue();
      return;
    }
    if (out.sampleRate !== VOICE_RATE) {
      // Gemini Live always speaks 24 kHz; anything else is a bug upstream.
      console.error(`live-agent: dropped voice at ${out.sampleRate} Hz (expected ${VOICE_RATE})`);
      return;
    }
    pending.push(out.data);
    void pump().catch((err) => console.error("live-agent: voice playback failed:", err));
  });

  return {
    async close() {
      if (closed) return;
      closed = true;
      offAudio();
      pending = [];
      generation++;
      await room.disconnect();
      await voice.close();
    },
  };
}
