// The agent core's event stream: everything the app (and every test) can see.
//
// Why one union type: the Tauri shell, the live smoke test and the fast tests
// all read the same stream, so a new feature is "add one event type here and
// emit it". Later tickets add, for example:
//   { type: "tool.call" }, { type: "safety.verdict" }, { type: "job.state" },
//   { type: "notes.used" }, { type: "brain.write" }
// Every event is plain JSON, so the core can later pipe it to the app as
// JSON lines without a translation layer.

export type AgentEvent =
  /** Something said in the chat. Model text arrives in chunks: join them in order. */
  | { type: "transcript"; role: "user" | "model"; text: string }
  /** The model finished its reply. `reply` is the whole reply, joined for you. */
  | { type: "turn.done"; reply: string }
  /** Something went wrong in the session. The session may still be usable. */
  | { type: "error"; message: string };

/** Pick one event type out of the union, e.g. `EventOf<"turn.done">`. */
export type EventOf<T extends AgentEvent["type"]> = Extract<AgentEvent, { type: T }>;
