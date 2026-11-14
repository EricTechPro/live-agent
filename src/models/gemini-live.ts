// The real model: Gemini Live over a websocket, via @google/genai.
//
// Gemini Live speaks (AUDIO out). We also ask it for an output transcription,
// which is the text of what it said; that text becomes our transcript events.
// The audio itself is ignored for now; voice arrives with ticket 08.
import {
  Behavior,
  FunctionResponseScheduling,
  GoogleGenAI,
  Modality,
  type LiveServerMessage,
} from "@google/genai";
import type { Model, ModelEvent } from "../core/model.ts";

export const DEFAULT_LIVE_MODEL = "gemini-3.8-live";

export interface GeminiLiveOptions {
  /** Read it from the environment (GEMINI_API_KEY). Never hard-code it. */
  apiKey: string;
  model?: string;
}

export function geminiLiveModel(options: GeminiLiveOptions): Model {
  // Why pin v1beta: @google/genai 3.3.0 defaults to "v1", and the Live
  // WebSocket endpoint only answers on v1beta/v1alpha (v1 returns 404, which
  // shows up as "Expected 101 status code").
  const ai = new GoogleGenAI({
    apiKey: options.apiKey,
    httpOptions: { apiVersion: "v1beta" },
  });

  return {
    async connect(onEvent, connectOptions) {
      // Set while *we* are closing, so our own goodbye is not reported as an error.
      let closing = false;

      const session = await ai.live.connect({
        model: options.model ?? DEFAULT_LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
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

// One server message can carry several things at once: tool calls, a
// transcription chunk and the end of the turn. Order matters: done comes last.
function toModelEvents(message: LiveServerMessage): ModelEvent[] {
  const events: ModelEvent[] = [];
  for (const call of message.toolCall?.functionCalls ?? []) {
    events.push({ type: "tool.call", id: call.id ?? "", name: call.name ?? "", args: call.args ?? {} });
  }
  const content = message.serverContent;
  if (!content) return events;
  const text = content.outputTranscription?.text;
  if (text) events.push({ type: "text", text });
  if (content.turnComplete) events.push({ type: "turn.complete" });
  return events;
}
