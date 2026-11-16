// The Gemini Live adapter's translation of server messages into ModelEvents.
// No network: these are server messages shaped like the Live API sends them.
import { describe, expect, test } from "bun:test";
import type { LiveServerMessage } from "@google/genai";
import { toModelEvents } from "../src/models/gemini-live.ts";

const pcmBase64 = Buffer.from(new Int16Array([100, -100, 32767]).buffer).toString("base64");

describe("Gemini Live server messages to model events", () => {
  test("model voice becomes 24 kHz PCM audio events", () => {
    const message = {
      serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: "audio/pcm;rate=24000", data: pcmBase64 } }] } },
    } as LiveServerMessage;

    expect(toModelEvents(message)).toEqual([
      { type: "audio", data: new Int16Array([100, -100, 32767]), sampleRate: 24000 },
    ]);
  });

  test("what the user said becomes user.text; interruption comes before the turn ends", () => {
    const message = {
      serverContent: { inputTranscription: { text: "wait, stop" }, interrupted: true, turnComplete: true },
    } as LiveServerMessage;

    expect(toModelEvents(message)).toEqual([
      { type: "user.text", text: "wait, stop" },
      { type: "interrupted" },
      { type: "turn.complete" },
    ]);
  });

  test("the server taking back tool calls becomes tool.cancel", () => {
    const message = { toolCallCancellation: { ids: ["c1", "c2"] } } as LiveServerMessage;

    expect(toModelEvents(message)).toEqual([{ type: "tool.cancel", ids: ["c1", "c2"] }]);
  });

  test("generation complete comes after the last words and before the turn ends", () => {
    const message = {
      serverContent: { outputTranscription: { text: "Bye." }, generationComplete: true, turnComplete: true },
    } as LiveServerMessage;

    expect(toModelEvents(message)).toEqual([
      { type: "text", text: "Bye." },
      { type: "generation.complete" },
      { type: "turn.complete" },
    ]);
  });
});
