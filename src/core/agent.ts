// The agent core: the single entry point the app and the tests use.
//
//   const session = await startSession({ model });
//   session.onEvent((e) => ...);              // every event, as it happens
//   const events = await session.sendText("hi");  // or: just this turn's events
//   await session.close();
//
// Why this shape: voice comes later (ticket 08), but a text turn is the same
// conversation without a microphone, so every test can drive the real core
// through text alone (the same trick as live-dj's smoke_live).
import type { AgentEvent } from "./events.ts";
import type { Model, ModelEvent } from "./model.ts";

export interface SessionOptions {
  /** Which model to talk to: `geminiLiveModel(...)` for real, `scriptedModel(...)` in tests. */
  model: Model;
}

export interface AgentSession {
  /** Send one text turn. Resolves with every event of that turn, ending with `turn.done`. */
  sendText(text: string): Promise<AgentEvent[]>;
  /** Listen to every event on the stream. Returns a function that stops listening. */
  onEvent(listener: (event: AgentEvent) => void): () => void;
  close(): Promise<void>;
}

export async function startSession(options: SessionOptions): Promise<AgentSession> {
  const listeners = new Set<(event: AgentEvent) => void>();

  // The turn in flight: the events gathered so far and how to hand them back.
  // Why only one: a live conversation takes turns, so the core does too.
  let turn: { events: AgentEvent[]; reply: string; done: (events: AgentEvent[]) => void } | null =
    null;

  // Every event goes through here, so listeners and the current turn always
  // see exactly the same stream.
  function emit(event: AgentEvent) {
    turn?.events.push(event);
    for (const listener of listeners) listener(event);
  }

  // Translate what the model says into what the app sees.
  function onModelEvent(event: ModelEvent) {
    switch (event.type) {
      case "text":
        if (turn) turn.reply += event.text;
        emit({ type: "transcript", role: "model", text: event.text });
        break;
      case "turn.complete": {
        const finished = turn;
        emit({ type: "turn.done", reply: finished?.reply ?? "" });
        turn = null;
        finished?.done(finished.events);
        break;
      }
      case "error":
        emit({ type: "error", message: event.message });
        break;
    }
  }

  const modelSession = await options.model.connect(onModelEvent);

  return {
    sendText(text) {
      if (turn) return Promise.reject(new Error("a turn is already in progress"));
      return new Promise((done) => {
        turn = { events: [], reply: "", done };
        emit({ type: "transcript", role: "user", text });
        modelSession.sendText(text);
      });
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => modelSession.close(),
  };
}
