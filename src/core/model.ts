// The model seam: the small shape every model adapter fills in.
//
// Why a seam here: the agent core should not know whether it is talking to
// real Gemini Live or a scripted fake. Both adapters (src/models/*) turn their
// own wire format into these few ModelEvents, and the core turns ModelEvents
// into AgentEvents for the app. Swap the adapter, keep everything else.

/** What a model can say back. Later tickets add e.g. `{ type: "tool.call" }`. */
export type ModelEvent =
  /** A chunk of the spoken reply, as text (Gemini Live's output transcription). */
  | { type: "text"; text: string }
  /** The model is done with this turn and is waiting for the user. */
  | { type: "turn.complete" }
  /** The connection or the model reported a problem. */
  | { type: "error"; message: string };

/** One open conversation with a model. */
export interface ModelSession {
  /** Send one user text turn. Replies arrive through the `onEvent` given to `connect`. */
  sendText(text: string): void;
  close(): Promise<void>;
}

export interface Model {
  /** Open a conversation. The adapter calls `onEvent` for every ModelEvent, in order. */
  connect(onEvent: (event: ModelEvent) => void): Promise<ModelSession>;
}
