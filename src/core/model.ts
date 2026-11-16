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
  /**
   * The model takes back tool calls it made (e.g. the user talked over it).
   * Their answers must not be sent.
   */
  | { type: "tool.cancel"; ids: string[] }
  /** A chunk of what the user said out loud (Gemini Live's input transcription). */
  | { type: "user.text"; text: string }
  /** A chunk of the model's voice: 16-bit mono PCM (Gemini Live speaks at 24 kHz). */
  | { type: "audio"; data: Int16Array; sampleRate: number }
  /** The user talked over the model. Stop playing its voice now; `turn.complete` follows. */
  | { type: "interrupted" }
  /**
   * The model has generated its whole reply (all of its text is in). Its voice
   * may still be playing: Gemini Live sends `turn.complete` only once the
   * spoken reply would have finished, which can be 15+ seconds later.
   */
  | { type: "generation.complete" }
  /** The model is done with this turn and is waiting for the user. */
  | { type: "turn.complete" }
  /**
   * The connection dropped. Anything the model still owed us (a reply, the end
   * of a turn) is lost. The adapter reconnects by itself; this is said once
   * per drop (and again if it gives up reconnecting).
   */
  | { type: "disconnected"; message: string }
  /**
   * No network (ticket 40): the adapter could not reach the model and tries again in
   * `retryInMs`. It keeps trying; `attempt` counts the tries in a row. Input sent now is dropped.
   */
  | { type: "reconnecting"; attempt: number; retryInMs: number; message: string }
  /** Reached the model again after `reconnecting`. */
  | { type: "connected" }
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
export type ModelInput =
  | { type: "text"; text: string }
  | { type: "audio"; data: Int16Array; sampleRate: number }
  /** A still image (a screenshot) for the model to see; it answers the text that comes with it. */
  | { type: "image"; data: Uint8Array; mimeType: string }
  | ({ type: "tool.response" } & ToolResponse);

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
  /**
   * Stream a chunk of the user's microphone: 16-bit mono PCM (Gemini wants 16 kHz).
   * There is no "end of turn" call: the model hears when the user stops talking.
   */
  sendAudio(data: Int16Array, sampleRate: number): void;
  /**
   * Show the model a still image (a JPEG screenshot). It gets no reply of its own: the text
   * or tool answer sent right after it is what the model answers. Optional: a model without
   * eyes leaves it out.
   */
  sendImage?(data: Uint8Array, mimeType: string): void;
  /** Answer a `tool.call`. Replies (if any) arrive through `onEvent`. */
  sendToolResponse(response: ToolResponse): void;
  /** No network (ticket 40): stop waiting out the backoff and try to connect now. */
  retryNow?(): void;
  /**
   * Speak with a new voice and system instruction, same conversation (the set_voice tool).
   * Gemini fixes both per connection, so the adapter opens a new connection with the
   * session resume handle and moves over to it. Optional: without it, the change
   * applies from the next connection.
   */
  reconfigure?(change: Pick<ConnectOptions, "voice" | "systemInstruction">): Promise<void>;
  close(): Promise<void>;
}

export interface ConnectOptions {
  /** The tools the model may call. All of them run NON_BLOCKING. */
  tools: ToolDeclaration[];
  /** The prebuilt voice to speak with (config `voice`, e.g. "Puck"). */
  voice?: string;
  /** Who the model is and how it talks (built from config `tone`, see src/core/tone.ts). */
  systemInstruction?: string;
  /** Which model to talk with (config `liveModel`). Unset: the adapter's own default. */
  model?: string;
}

export interface Model {
  /** Open a conversation. The adapter calls `onEvent` for every ModelEvent, in order. */
  connect(onEvent: (event: ModelEvent) => void, options?: ConnectOptions): Promise<ModelSession>;
}
