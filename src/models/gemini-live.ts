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
import {
  Behavior,
  FunctionResponseScheduling,
  GoogleGenAI,
  Modality,
  type LiveServerMessage,
} from "@google/genai";
import type { Model, ModelEvent } from "../core/model.ts";

export const DEFAULT_LIVE_MODEL = "gemini-3.8-live";

export type GeminiLiveOptions = {
  model?: string;
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
  // v1alpha, so a token connection uses that.
  async function client() {
    if (options.token) {
      return new GoogleGenAI({ apiKey: await options.token(), httpOptions: { apiVersion: "v1alpha" } });
    }
    return new GoogleGenAI({ apiKey: options.apiKey, httpOptions: { apiVersion: "v1beta" } });
  }

  return {
    async connect(onEvent, connectOptions) {
      // Set while *we* are closing, so our own goodbye is not reported as an error.
      let closing = false;
      const ai = await client();

      const session = await ai.live.connect({
        model: options.model ?? DEFAULT_LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
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
        },
        callbacks: {
          onmessage: (message) => toModelEvents(message).forEach(onEvent),
          onerror: (e) => onEvent({ type: "error", message: String(e.message ?? e) }),
          onclose: (e) => {
            if (closing) return;
            // The server hung up. End any turn in flight so nobody waits forever.
            onEvent({ type: "error", message: `Gemini Live closed: ${e.code} ${e.reason}` });
            onEvent({ type: "turn.complete" });
          },
        },
      });

      return {
        sendText(text) {
          // Why realtime text (not sendClientContent): newer Live models take
          // turn-by-turn text the same way they take audio, and treat
          // sendClientContent as "prefill history". One path for both.
          session.sendRealtimeInput({ text });
        },
        sendAudio(data, sampleRate) {
          const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength); // Int16 little-endian
          session.sendRealtimeInput({
            audio: { data: bytes.toString("base64"), mimeType: `audio/pcm;rate=${sampleRate}` },
          });
        },
        sendToolResponse({ id, name, response, scheduling, willContinue }) {
          session.sendToolResponse({
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
          session.close();
        },
      };
    },
  };
}

// Gemini Live's voice: 16-bit mono PCM at this rate (it says so in the mimeType too).
const OUTPUT_RATE = 24000;

// One server message can carry several things at once: tool calls, voice,
// transcription chunks, an interruption and the end of the turn.
// Order matters: interrupted just before done, done comes last.
export function toModelEvents(message: LiveServerMessage): ModelEvent[] {
  const events: ModelEvent[] = [];
  for (const call of message.toolCall?.functionCalls ?? []) {
    events.push({ type: "tool.call", id: call.id ?? "", name: call.name ?? "", args: call.args ?? {} });
  }
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
  if (content.interrupted) events.push({ type: "interrupted" });
  if (content.turnComplete) events.push({ type: "turn.complete" });
  return events;
}
