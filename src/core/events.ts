// The agent core's event stream: everything the app (and every test) can see.
//
// Why one union type: the Tauri shell, the live smoke test and the fast tests
// all read the same stream, so a new feature is "add one event type here and
// emit it". Later tickets add, for example:
//   { type: "job.state" }, { type: "notes.used" }, { type: "brain.write" }
// Every event is plain JSON, so the core can later pipe it to the app as
// JSON lines without a translation layer.
import type { SafetyMode, Verdict } from "./safety.ts";
import type { RiskClass } from "./tool.ts";

export type AgentEvent =
  /** Something said in the chat. Model text arrives in chunks: join them in order. */
  | { type: "transcript"; role: "user" | "model"; text: string }
  /** The model asked for a tool. Every call shows up here, allowed or not. `risk` is missing for unknown tools. */
  | { type: "tool.call"; id: string; name: string; args: Record<string, unknown>; risk?: RiskClass }
  /** The safety gate's verdict on a call. An "ask" is followed by an "allow" once the user says yes. */
  | {
      type: "safety.verdict";
      id: string;
      name: string;
      risk?: RiskClass;
      mode: SafetyMode;
      verdict: Verdict;
      reason: string;
    }
  /**
   * What the core told the model about a call:
   * ok (with output), error, blocked (never ran), waiting (for the user's yes),
   * declined (the user did not say yes, so it never ran).
   */
  | {
      type: "tool.result";
      id: string;
      name: string;
      status: "ok" | "error" | "blocked" | "waiting" | "declined";
      output?: unknown;
      error?: string;
    }
  /** The model finished its reply. `reply` is the whole reply, joined for you. */
  | { type: "turn.done"; reply: string }
  /** Something went wrong in the session. The session may still be usable. */
  | { type: "error"; message: string };

/** Pick one event type out of the union, e.g. `EventOf<"turn.done">`. */
export type EventOf<T extends AgentEvent["type"]> = Extract<AgentEvent, { type: T }>;
