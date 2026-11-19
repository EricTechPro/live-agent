// The real model: Gemini Live over a websocket, via @google/genai.
//
// Gemini Live speaks (AUDIO out). We also ask it for transcriptions of both
// sides: what it said becomes `text` events, what it heard becomes `user.text`.
// Voice (ticket 08): mic audio goes in as 16 kHz PCM, its voice comes out as
// 24 kHz PCM `audio` events, and `interrupted` means the user talked over it.
//
// Keys: pass `token` (a function that mints a single-use ephemeral token, see
// src/voice/token-service.ts) so this module never holds the real key. `apiKey`
// still works for the smoke test and simple scripts.
//
// Reconnects: Google ends Live connections on its own schedule (a goAway
// warning before a session limit, or a plain drop). One `connect()` here is
// one conversation that outlives its connections: the server keeps handing us
// a resumption handle, and a new connection made with it carries on the same
// chat. Context window compression lifts the 15-minute audio session limit.
//
// No network (ticket 40: the Mac slept, Wi-Fi dropped, DNS fails): the adapter never
// gives up and never throws out of `connect()` for that. It keeps dialing with backoff
// (1 s, 2 s, 5 s, 10 s, then every 30 s) and says so with `reconnecting` / `connected`
// events, so the core stays up and the window shows "Reconnecting…".
import { errorMessage } from "../errors.ts";
import {
  Behavior,
  EndSensitivity,
  FunctionResponseScheduling,
  GoogleGenAI,
  Modality,
  type LiveConnectConfig,
  type LiveConnectParameters,
  type LiveSendRealtimeInputParameters,
  type LiveSendToolResponseParameters,
  type LiveServerMessage,
} from "@google/genai";
import type { Model, ModelEvent } from "../core/model.ts";
import { DEFAULT_LIVE_MODEL } from "./live-models.ts";

export { DEFAULT_LIVE_MODEL };

const NETWORK_CODES = /\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ENETDOWN|EPIPE|ECONNABORTED)\b/;

/** A failure that is the network's fault (DNS, refused, reset, timeout), not the key's or the model's. */
export function isNetworkError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && NETWORK_CODES.test(code)) return true;
  const message = errorMessage(err);
  return NETWORK_CODES.test(message) || /fetch failed|getaddrinfo|Unable to connect|socket connection was closed/i.test(message);
}

/** Backoff while the network is down: 1 s, 2 s, 5 s, 10 s, then every 30 s, for as long as it takes. */
export const NETWORK_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000];
export function networkRetryDelay(attempt: number, delays: number[] = NETWORK_DELAYS_MS): number {
  return delays[Math.min(attempt, delays.length - 1)]!;
}

// Google closed the connection because nothing was sent for a while (no call, mic off).
// Nothing is lost: connect again when there is something to send, not in a loop.
const IDLE_CLOSE = /inactivity/i;
// The resume handle is no good any more: the next connection must start a fresh session.
const STALE_HANDLE = /not found|expired|already exists/i;

/** The bits of a Live connection we use (what `ai.live.connect` resolves with). */
export interface LiveSocket {
  sendRealtimeInput(params: LiveSendRealtimeInputParameters): void;
  sendToolResponse(params: LiveSendToolResponseParameters): void;
  close(): void;
}

/** Opens one Live connection. Default: `ai.live.connect`; tests pass a fake server. */
export type LiveConnect = (params: LiveConnectParameters) => Promise<LiveSocket>;

export type GeminiLiveOptions = {
  model?: string;
  /** Swap the websocket for a fake Live server (tests). */
  connect?: LiveConnect;
  /** Waits between reconnect attempts after a drop. Default [500, 2000, 5000] ms, then give up until the next send. */
  retryDelaysMs?: number[];
  /** Waits between attempts while the network is down; the last repeats forever. Default NETWORK_DELAYS_MS. */
  networkDelaysMs?: number[];
} & (
  | {
      /** Read it from the environment (GEMINI_API_KEY). Never hard-code it. */
      apiKey: string;
      token?: never;
    }
  | {
      /** Mints a fresh single-use ephemeral token for each connection. */
      token: () => Promise<string>;
      apiKey?: never;
    }
);

export function geminiLiveModel(options: GeminiLiveOptions): Model {
  // Why pin v1beta: @google/genai 3.3.0 defaults to "v1", and the Live
  // WebSocket endpoint only answers on v1beta/v1alpha (v1 returns 404, which
  // shows up as "Expected 101 status code"). Ephemeral tokens only work on
  // v1alpha, so a token connection uses that. A token is single-use, so every
  // connection (reconnects too) mints its own.
  const open: LiveConnect =
    options.connect ??
    (async (params) => {
      const ai = options.token
        ? new GoogleGenAI({ apiKey: await options.token(), httpOptions: { apiVersion: "v1alpha" } })
        : new GoogleGenAI({ apiKey: options.apiKey, httpOptions: { apiVersion: "v1beta" } });
      return ai.live.connect(params);
    });
  const retryDelaysMs = options.retryDelaysMs ?? [500, 2000, 5000];
  const networkDelaysMs = options.networkDelaysMs ?? NETWORK_DELAYS_MS;

  return {
    name: options.model ?? DEFAULT_LIVE_MODEL,
    async connect(onEvent, connectOptions) {
      const config: LiveConnectConfig = {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        ...(connectOptions?.voice
          ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: connectOptions.voice } } } }
          : {}),
        ...(connectOptions?.systemInstruction ? { systemInstruction: connectOptions.systemInstruction } : {}),
        // Why: the default (HIGH end-of-speech sensitivity) ends the user's turn at
        // the first short pause. Jett then starts answering, the rest of the
        // sentence talks over it, and the answer is dropped as "interrupted".
        // LOW plus 1.2 s of silence lets people think mid-question.
        realtimeInputConfig: {
          automaticActivityDetection: { endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW, silenceDurationMs: 1200 },
        },
        // Why: without it an audio session ends after 15 minutes.
        contextWindowCompression: { slidingWindow: {} },
        // Every tool is NON_BLOCKING: the model keeps talking while a tool
        // runs, and we send the answer whenever it is ready.
        tools: connectOptions?.tools.length
          ? [
              {
                functionDeclarations: connectOptions.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parametersJsonSchema: t.parameters,
                  behavior: Behavior.NON_BLOCKING,
                })),
              },
            ]
          : undefined,
      };

      // One entry per connection we opened. `retired`: replaced after a goAway,
      // so its close is expected, but it may still finish what it was saying.
      type Link = { socket?: LiveSocket; open: boolean; retired: boolean; hangUpAfterTurn?: boolean };
      const links = new Set<Link>();
      let live: Link | undefined; // where new input goes
      let handle: string | undefined; // the latest resumption handle
      let closing = false; // set while *we* close, so our own goodbye is not an error
      let reconnecting: Promise<void> | undefined;
      // Cuts the current wait between network retries short (the window's Retry).
      let wake: (() => void) | undefined;
      const nap = (ms: number) =>
        new Promise<void>((done) => {
          const timer = setTimeout(done, ms);
          wake = () => {
            clearTimeout(timer);
            done();
          };
        }).finally(() => (wake = undefined));
      // Input sent while there is no live connection, delivered once there is.
      let pending: ((socket: LiveSocket) => void)[] = [];
      // Which connection each tool call came from: its answer goes back there.
      const callLink = new Map<string, Link>();

      async function dial(): Promise<Link> {
        const link: Link = { open: true, retired: false };
        const socket = await open({
          model: options.model ?? DEFAULT_LIVE_MODEL,
          config: { ...config, sessionResumption: handle ? { handle } : {} },
          callbacks: {
            onmessage: (message) => {
              const update = message.sessionResumptionUpdate;
              if (update?.resumable && update.newHandle) handle = update.newHandle;
              for (const call of message.toolCall?.functionCalls ?? []) if (call.id) callLink.set(call.id, link);
              toModelEvents(message).forEach(onEvent);
              if (link.hangUpAfterTurn && message.serverContent?.turnComplete) link.socket?.close();
              if (message.goAway) {
                // Logged (core.log) so planned handovers can be told apart from drops.
                console.error(`live-agent: Gemini Live goAway (time left ${message.goAway.timeLeft ?? "?"}): handing over to a new connection`);
                handOver(link);
              }
            },
            onerror: (e) => onEvent({ type: "error", message: String(e.message ?? e) }),
            onclose: (e) => {
              link.open = false;
              links.delete(link);
              const idle = IDLE_CLOSE.test(e.reason ?? "");
              const planned = closing ? "we closed it" : link.retired ? "after a goAway handover" : idle ? "idle, reconnects on the next input" : "a drop";
              console.error(`live-agent: Gemini Live closed: ${e.code} ${e.reason || "(no reason)"} (${planned})`);
              if (STALE_HANDLE.test(e.reason ?? "")) handle = undefined;
              if (closing || link.retired || link !== live) return;
              live = undefined;
              // Idle: nothing was in flight, so nothing to report; the next send dials.
              if (idle) return;
              onEvent({ type: "disconnected", message: `Gemini Live closed: ${e.code} ${e.reason}`.trim() });
              void reconnect();
            },
          },
        });
        link.socket = socket;
        // close() ran while this one was dialing: hang it up, never leave it running.
        if (closing) {
          link.open = false;
          socket.close();
          throw new Error("closed");
        }
        links.add(link);
        return link;
      }

      // goAway: the server will close this connection soon. Start the next one
      // now, so the user never waits on a dead socket.
      function handOver(link: Link) {
        if (link !== live) return;
        link.retired = true;
        live = undefined;
        void reconnect();
      }

      function reconnect(): Promise<void> {
        reconnecting ??= (async () => {
          let lastError: unknown;
          let offline = 0; // tries in a row that failed for the network
          for (let attempt = 0; !closing; attempt++) {
            try {
              live = await dial();
              if (offline) onEvent({ type: "connected" });
              for (const deliver of pending.splice(0)) deliver(live.socket!);
              return;
            } catch (err) {
              if (closing) return;
              lastError = err;
              if (isNetworkError(err)) {
                // No network: keep going, slower and slower, for as long as it takes.
                // Input that was waiting is old by the time it is back: drop it.
                pending = [];
                const wait = networkRetryDelay(offline++, networkDelaysMs);
                console.error(`live-agent: no network (${errorMessage(err)}): retrying in ${wait / 1000}s`);
                onEvent({ type: "reconnecting", attempt: offline, retryInMs: wait, message: errorMessage(err) });
                await nap(wait);
                continue;
              }
              // A stale handle can be the problem: the next try starts a fresh session.
              if (attempt > 0) handle = undefined;
              const wait = retryDelaysMs[attempt];
              if (wait === undefined) break;
              await Bun.sleep(wait);
            }
          }
          if (closing) return;
          // Give up for now. Input that was waiting is lost, so say so: the core
          // ends the turn. The next send tries again.
          pending = [];
          const why = errorMessage(lastError);
          onEvent({ type: "disconnected", message: `could not reconnect to Gemini Live: ${why}` });
        })().finally(() => (reconnecting = undefined));
        return reconnecting;
      }

      function send(deliver: (socket: LiveSocket) => void) {
        if (live?.socket) return deliver(live.socket);
        pending.push(deliver);
        void reconnect();
      }

      // The first connection. With no network the session still opens: it keeps
      // dialing in the background (reconnecting events) instead of failing the start.
      try {
        live = await dial();
      } catch (err) {
        if (!isNetworkError(err)) throw err;
        void reconnect();
      }

      return {
        sendText(text) {
          // Why realtime text (not sendClientContent): newer Live models take
          // turn-by-turn text the same way they take audio, and treat
          // sendClientContent as "prefill history". One path for both.
          send((socket) => socket.sendRealtimeInput({ text }));
        },
        sendAudio(data, sampleRate) {
          // Mic audio while reconnecting is dropped, not queued: it is already old.
          // But it does wake an idle-closed connection.
          if (!live?.socket) return void reconnect();
          const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength); // Int16 little-endian
          live.socket.sendRealtimeInput({
            audio: { data: bytes.toString("base64"), mimeType: `audio/pcm;rate=${sampleRate}` },
          });
        },
        sendImage(data, mimeType) {
          // Screen awareness: a screenshot goes in as one video frame. Live takes frames on
          // its realtime video input and treats them as what it sees right now.
          const base64 = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64");
          send((socket) => socket.sendRealtimeInput({ video: { data: base64, mimeType } }));
        },
        sendToolResponse({ id, name, response, scheduling, willContinue }) {
          // The connection that asked gets the answer; if it is gone, so is the call.
          const link = callLink.get(id) ?? live;
          if (!link?.open || !link.socket) return;
          link.socket.sendToolResponse({
            functionResponses: [
              {
                id,
                name,
                response,
                scheduling:
                  scheduling === "silent"
                    ? FunctionResponseScheduling.SILENT
                    : FunctionResponseScheduling.WHEN_IDLE,
                ...(willContinue === undefined ? {} : { willContinue }),
              },
            ],
          });
        },
        async reconfigure(change) {
          // Voice and system instruction are fixed per connection: change the config, then
          // hand over to a new connection made with the resume handle, like after a goAway.
          if (change.voice) config.speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: change.voice } } };
          if (change.systemInstruction) config.systemInstruction = change.systemInstruction;
          const old = live;
          if (!old) return; // idle or reconnecting: the next connection picks the new config up
          old.retired = true;
          live = undefined;
          await reconnect();
          // Answers to calls made on the old connection (set_voice's own) go to the new one,
          // so the reply after the switch is spoken in the new voice.
          if (live) for (const [id, link] of callLink) if (link === old) callLink.set(id, live);
          // Like a goAway handover, the old connection may finish what it was saying (its
          // turn end is still owed to the core); hang it up after that, or after 15 s.
          old.hangUpAfterTurn = true;
          setTimeout(() => old.socket?.close(), 15_000).unref?.();
        },
        retryNow() {
          // Waiting out a network backoff: try now. Nothing going on: dial now.
          if (wake) wake();
          else if (!live) void reconnect();
        },
        async close() {
          closing = true;
          wake?.();
          for (const link of links) link.socket?.close();
        },
      };
    },
  };
}

// Gemini Live's voice: 16-bit mono PCM at this rate (it says so in the mimeType too).
const OUTPUT_RATE = 24000;

// One server message can carry several things at once: tool calls, voice,
// transcription chunks, an interruption and the end of the turn.
// Order matters: the last words, then generation complete, then interrupted, done comes last.
export function toModelEvents(message: LiveServerMessage): ModelEvent[] {
  const events: ModelEvent[] = [];
  for (const call of message.toolCall?.functionCalls ?? []) {
    events.push({ type: "tool.call", id: call.id ?? "", name: call.name ?? "", args: call.args ?? {} });
  }
  const cancelled = message.toolCallCancellation?.ids;
  if (cancelled?.length) events.push({ type: "tool.cancel", ids: cancelled });
  // Token use: the whole request (prompt + reply) is what the context holds now.
  const u = message.usageMetadata;
  const usage: ModelEvent[] = u
    ? [{ type: "usage", contextTokens: u.totalTokenCount ?? (u.promptTokenCount ?? 0) + (u.responseTokenCount ?? 0) }]
    : [];
  const content = message.serverContent;
  if (!content) return [...events, ...usage];
  const heard = content.inputTranscription?.text;
  if (heard) events.push({ type: "user.text", text: heard });
  for (const part of content.modelTurn?.parts ?? []) {
    const audio = part.inlineData;
    if (!audio?.data || !audio.mimeType?.startsWith("audio/pcm")) continue;
    const rate = Number(/rate=(\d+)/.exec(audio.mimeType)?.[1] ?? OUTPUT_RATE);
    // Copy into a fresh buffer: Node Buffers can sit at an odd offset in a shared pool.
    const bytes = Uint8Array.from(Buffer.from(audio.data, "base64"));
    events.push({ type: "audio", data: new Int16Array(bytes.buffer, 0, bytes.byteLength >> 1), sampleRate: rate });
  }
  const text = content.outputTranscription?.text;
  if (text) events.push({ type: "text", text });
  if (content.generationComplete) events.push({ type: "generation.complete" });
  if (content.interrupted) events.push({ type: "interrupted" });
  events.push(...usage);
  if (content.turnComplete) events.push({ type: "turn.complete" });
  return events;
}
