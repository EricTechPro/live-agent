// The model seam: the small shape every model adapter fills in.
//
// Why a seam here: the agent core should not know whether it is talking to
// real Gemini Live or a scripted fake. Both adapters (src/models/*) turn their
// own wire format into these few ModelEvents, and the core turns ModelEvents
// into AgentEvents for the app. Swap the adapter, keep everything else.

/** What a model can say back. */
export type ModelEvent =
  /** A chunk of the spoken reply, as text (Gemini Live's output transcription). */
  | { type: "text"; text: string }
  /** The model wants a tool run. `id` ties the answer (a ToolResponse) back to this call. */
  | { type: "tool.call"; id: string; name: string; args: Record<string, unknown> }
  /** The model is done with this turn and is waiting for the user. */
  | { type: "turn.complete" }
  /** The connection or the model reported a problem. */
  | { type: "error"; message: string };

/**
 * The core's answer to a tool call.
 *
 * Tools are NON_BLOCKING: the model keeps talking while they run, and the
 * answer arrives whenever it is ready.
 * - `scheduling: "when-idle"` (default): the model speaks about it once it is quiet.
 * - `scheduling: "silent"`: the model only notes it; it does not start speaking.
 * - `willContinue: true`: more answers for the same call will follow (used while
 *   a call waits for the user's yes).
 */
export interface ToolResponse {
  id: string;
  name: string;
  /** `{ output }` on success, `{ error }` on failure, or a status the model should explain. */
  response: Record<string, unknown>;
  scheduling?: "when-idle" | "silent";
  willContinue?: boolean;
}

/** Everything the core can send into the model: a user text turn or a tool answer. */
export type ModelInput = { type: "text"; text: string } | ({ type: "tool.response" } & ToolResponse);

/** What the model is told about a tool, so it knows it can call it. */
export interface ToolDeclaration {
  name: string;
  description: string;
  /** JSON Schema of the args object. */
  parameters: Record<string, unknown>;
}

/** One open conversation with a model. */
export interface ModelSession {
  /** Send one user text turn. Replies arrive through the `onEvent` given to `connect`. */
  sendText(text: string): void;
  /** Answer a `tool.call`. Replies (if any) arrive through `onEvent`. */
  sendToolResponse(response: ToolResponse): void;
  close(): Promise<void>;
}

export interface ConnectOptions {
  /** The tools the model may call. All of them run NON_BLOCKING. */
  tools: ToolDeclaration[];
}

export interface Model {
  /** Open a conversation. The adapter calls `onEvent` for every ModelEvent, in order. */
  connect(onEvent: (event: ModelEvent) => void, options?: ConnectOptions): Promise<ModelSession>;
}
