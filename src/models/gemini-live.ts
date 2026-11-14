// The real model: Gemini Live over a websocket, via @google/genai.
//
// Gemini Live speaks (AUDIO out). We also ask it for an output transcription,
// which is the text of what it said; that text becomes our transcript events.
// The audio itself is ignored for now; voice arrives with ticket 08.
import { GoogleGenAI, Modality, type LiveServerMessage } from "@google/genai";
import type { Model, ModelEvent } from "../core/model.ts";

export const DEFAULT_LIVE_MODEL = "gemini-3.8-live";

export interface GeminiLiveOptions {
  /** Read it from the environment (GEMINI_API_KEY). Never hard-code it. */
  apiKey: string;
  model?: string;
}

export function geminiLiveModel(options: GeminiLiveOptions): Model {
  const ai = new GoogleGenAI({ apiKey: options.apiKey });

  return {
    async connect(onEvent) {
      // Set while *we* are closing, so our own goodbye is not reported as an error.
      let closing = false;

      const session = await ai.live.connect({
        model: options.model ?? DEFAULT_LIVE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          outputAudioTranscription: {},
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
        async close() {
          closing = true;
          session.close();
        },
      };
    },
  };
}

// One server message can carry several things at once: a transcription chunk
// and the end of the turn, for example. Order matters: text first, then done.
function toModelEvents(message: LiveServerMessage): ModelEvent[] {
  const content = message.serverContent;
  if (!content) return [];
  const events: ModelEvent[] = [];
  const text = content.outputTranscription?.text;
  if (text) events.push({ type: "text", text });
  if (content.turnComplete) events.push({ type: "turn.complete" });
  return events;
}
