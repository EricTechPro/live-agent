// The agent core's event stream: everything the app (and every test) can see.
//
// Why one union type: the Tauri shell, the live smoke test and the fast tests
// all read the same stream, so a new feature is "add one event type here and
// emit it". Later tickets add, for example:
//   { type: "job.state" }, { type: "notes.used" }, { type: "brain.write" }
// Every event is plain JSON, so the core can later pipe it to the app as
// JSON lines without a translation layer.
import type { Config } from "../config/index.ts";
import type { JobInfo } from "./jobs.ts";
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
   * declined (the user did not say yes, so it never ran), cancelled (the model
   * dropped the call, e.g. the user talked over it or the connection dropped).
   */
  | {
      type: "tool.result";
      id: string;
      name: string;
      status: "ok" | "error" | "blocked" | "waiting" | "declined" | "cancelled";
      output?: unknown;
      error?: string;
    }
  /** The user talked over the model, so it stopped mid-reply. The turn still ends with `turn.done`. */
  | { type: "interrupted" }
  /**
   * A background job changed state: queued -> running -> done | failed | cancelled
   * (a queued job can go straight to cancelled). `message` is the summary (done)
   * or what went wrong and how to fix it (failed).
   */
  | ({ type: "job.state" } & JobInfo)
  /** The brain notes this turn's answer used (paths inside the brain, e.g. `wiki/x.md`). Sent once, just before `turn.done`. */
  | { type: "notes.used"; notes: string[] }
  /**
   * A note was written into the brain (`path` inside the brain, e.g. `raw/2026-11-13-chat.md`).
   * `cause`: "tool" (a tool such as `remember`, named in `tool`) or "chat-end" (the one note
   * `close()` writes about the chat). Ticket 07 queues the tidy job on the "chat-end" one.
   */
  | { type: "brain.write"; path: string; cause: "tool" | "chat-end"; tool?: string }
  /**
   * The safety mode changed (the window's dropdown or Shift+Tab). The window draws
   * the mode only from this event, so the dropdown and Shift+Tab never disagree.
   */
  | { type: "mode.changed"; mode: SafetyMode }
  /** The setup wizard wrote the config file. Its settings are in use at once (a `mode.changed` comes first if the mode changed). */
  | { type: "setup.saved"; configPath: string; config: Config }
  /**
   * A new chat began (New chat, or a quiet spell): the last one left its note
   * and tidy job, and the model starts fresh. The window clears the transcript.
   */
  | { type: "chat.started" }
  /**
   * A diagram to show (ticket 16): Mermaid `source` from the `draw_diagram` tool
   * (`id` is its call). The window draws it in a panel; bad source shows as an error there.
   */
  | { type: "diagram"; id: string; title?: string; source: string }
  /** The model finished its reply. `reply` is the whole reply, joined for you. */
  | { type: "turn.done"; reply: string }
  /** Something went wrong in the session. The session may still be usable. */
  | { type: "error"; message: string };

/** Pick one event type out of the union, e.g. `EventOf<"turn.done">`. */
export type EventOf<T extends AgentEvent["type"]> = Extract<AgentEvent, { type: T }>;
