// A scripted fake model for fast tests: no network, no key, same seam as Gemini Live.
//
//   scriptedModel([
//     [{ type: "text", text: "Hi!" }],        // reply to the 1st user turn
//     [{ type: "text", text: "Sure." }],      // reply to the 2nd user turn
//   ])
//
// Why a script of ModelEvents (not just reply strings): later tickets need the
// fake to "decide" to call tools, so they add a `tool.call` ModelEvent and put
// it in the script. The fake itself does not need to change.
import type { Model, ModelEvent } from "../core/model.ts";

export function scriptedModel(script: ModelEvent[][]): Model {
  let next = 0;
  return {
    async connect(onEvent) {
      return {
        sendText() {
          const reply = script[next++];
          if (!reply) {
            onEvent({ type: "error", message: `script has no reply for turn ${next}` });
            onEvent({ type: "turn.complete" });
            return;
          }
          // Reply on a later tick, like a real model over a socket, so tests
          // never depend on events arriving before `sendText` returns.
          queueMicrotask(() => {
            for (const event of reply) onEvent(event);
            // Every turn ends; the script only lists `turn.complete` when it
            // wants it somewhere unusual.
            if (!reply.some((e) => e.type === "turn.complete")) onEvent({ type: "turn.complete" });
          });
        },
        async close() {},
      };
    },
  };
}
