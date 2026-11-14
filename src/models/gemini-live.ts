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
import {
  Behavior,
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

export const DEFAULT_LIVE_MODEL = "gemini-3.8-live";

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

  return {
    async connect(onEvent, connectOptions) {
      const config: LiveConnectConfig = {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        ...(connectOptions?.voice
          ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: connectOptions.voice } } } }
          : {}),
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
      type Link = { socket?: LiveSocket; open: boolean; retired: boolean };
      const links = new Set<Link>();
      let live: Link | undefined; // where new input goes
      let handle: string | undefined; // the latest resumption handle
      let closing = false; // set while *we* close, so our own goodbye is not an error
      let reconnecting: Promise<void> | undefined;
      // Input sent while there is no live connection, delivered once there is.
      let pending: ((socket: LiveSocket) => void)[] = [];
      // Which connection each tool call came from: its answer goes back there.
      const callLink = new Map<string, Link>();

      async function dial(): Promise<Link> {
        const link: Link = { open: true, retired: false };
        link.socket = await open({
          model: options.model ?? DEFAULT_LIVE_MODEL,
          config: { ...config, sessionResumption: handle ? { handle } : {} },
          callbacks: {
            onmessage: (message) => {
              const update = message.sessionResumptionUpdate;
              if (update?.resumable && update.newHandle) handle = update.newHandle;
              for (const call of message.toolCall?.functionCalls ?? []) if (call.id) callLink.set(call.id, link);
              toModelEvents(message).forEach(onEvent);
              if (message.goAway) handOver(link);
            },
            onerror: (e) => onEvent({ type: "error", message: String(e.message ?? e) }),
            onclose: (e) => {
              link.open = false;
              links.delete(link);
              if (closing || link.retired || link !== live) return;
              live = undefined;
              onEvent({ type: "disconnected", message: `Gemini Live closed: ${e.code} ${e.reason}`.trim() });
              void reconnect();
            },
          },
        });
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
          for (let attempt = 0; attempt <= retryDelaysMs.length && !closing; attempt++) {
            try {
              live = await dial();
              for (const deliver of pending.splice(0)) deliver(live.socket!);
              return;
            } catch (err) {
              lastError = err;
              // A stale handle can be the problem: the next try starts a fresh session.
              if (attempt > 0) handle = undefined;
              const wait = retryDelaysMs[attempt];
              if (wait !== undefined) await Bun.sleep(wait);
            }
          }
          if (closing) return;
          // Give up for now. Input that was waiting is lost, so say so: the core
          // ends the turn. The next send tries again.
          pending = [];
          const why = lastError instanceof Error ? lastError.message : String(lastError);
          onEvent({ type: "disconnected", message: `could not reconnect to Gemini Live: ${why}` });
        })().finally(() => (reconnecting = undefined));
        return reconnecting;
      }

      function send(deliver: (socket: LiveSocket) => void) {
        if (live?.socket) return deliver(live.socket);
        pending.push(deliver);
        void reconnect();
      }

      live = await dial();

      return {
        sendText(text) {
          // Why realtime text (not sendClientContent): newer Live models take
          // turn-by-turn text the same way they take audio, and treat
          // sendClientContent as "prefill history". One path for both.
          send((socket) => socket.sendRealtimeInput({ text }));
        },
        sendAudio(data, sampleRate) {
          // Mic audio while reconnecting is dropped, not queued: it is already old.
          if (!live?.socket) return;
          const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength); // Int16 little-endian
          live.socket.sendRealtimeInput({
            audio: { data: bytes.toString("base64"), mimeType: `audio/pcm;rate=${sampleRate}` },
          });
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
        async close() {
          closing = true;
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
  const content = message.serverContent;
  if (!content) return events;
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
  if (content.turnComplete) events.push({ type: "turn.complete" });
  return events;
}
