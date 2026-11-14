// A scripted fake model for fast tests: no network, no key, same seam as Gemini Live.
//
//   scriptedModel([
//     [{ type: "text", text: "Hi!" }],                                   // reply to the 1st input
//     [{ type: "tool.call", id: "c1", name: "read_file", args: { path: "a.md" } }],
//     (input) => [{ type: "text", text: `Got ${JSON.stringify(input)}` }], // reply built from the input
//   ])
//
// One script entry per input the model would answer: every user text turn, and
// every tool response except "silent" ones (those only add to the context, the
// same as Gemini Live's SILENT scheduling). An entry can be a function of the
// input, so a test can prove a tool's output really reached the model.
//
// Voice: the first microphone chunk after a reply has finished counts as one
// spoken turn and plays the next entry; the chunks that follow while it replies
// are just the rest of the same utterance. Mic audio never runs past the end of
// the script (a live mic keeps sending), it is simply not answered.
import type { Model, ModelEvent, ModelInput } from "../core/model.ts";

export type ScriptEntry = ModelEvent[] | ((input: ModelInput) => ModelEvent[]);

export function scriptedModel(script: ScriptEntry[]): Model {
  let next = 0;
  return {
    async connect(onEvent) {
      // True from a reply's start until its `turn.complete` has gone out.
      let replying = false;
      function reply(input: ModelInput) {
        const entry = script[next++];
        if (!entry) {
          onEvent({ type: "error", message: `script has no reply for input ${next}` });
          onEvent({ type: "turn.complete" });
          return;
        }
        // Reply on a later tick, like a real model over a socket, so tests
        // never depend on events arriving before the send returns.
        replying = true;
        queueMicrotask(() => {
          const events = typeof entry === "function" ? entry(input) : entry;
          for (const event of events) onEvent(event);
          // Every reply ends; the script only lists `turn.complete` when it
          // wants it somewhere unusual.
          if (!events.some((e) => e.type === "turn.complete")) onEvent({ type: "turn.complete" });
          replying = false;
        });
      }
      return {
        sendText(text) {
          reply({ type: "text", text });
        },
        sendAudio(data, sampleRate) {
          if (replying || next >= script.length) return;
          reply({ type: "audio", data, sampleRate });
        },
        sendToolResponse(response) {
          if (response.scheduling === "silent") return;
          reply({ type: "tool.response", ...response });
        },
        async close() {},
      };
    },
  };
}
