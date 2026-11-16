// The agent core's event stream: everything the app (and every test) can see.
//
// Why one union type: the Tauri shell, the live smoke test and the fast tests
// all read the same stream, so a new feature is "add one event type here and
// emit it". Later tickets add, for example:
//   { type: "job.state" }, { type: "notes.used" }, { type: "brain.write" }
// Every event is plain JSON, so the core can later pipe it to the app as
// JSON lines without a translation layer.
import type { Config } from "../config/index.ts";
import type { Mark, MarkChange } from "./canvas.ts";
import type { JobInfo } from "./jobs.ts";
import type { SafetyMode, Verdict } from "./safety.ts";
import type { RiskClass } from "./tool.ts";
import type { Rect, ShotMap } from "../screen/geometry.ts";
import type { FrontWindow } from "../screen/eyes.ts";

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
  /** Pause on or off (the window's Pause button): while paused Jett neither speaks nor hears the mic. */
  | { type: "paused"; paused: boolean }
  /** The setup wizard wrote the config file. Its settings are in use at once (a `mode.changed` comes first if the mode changed). */
  | { type: "setup.saved"; configPath: string; config: Config }
  /**
   * A new chat began (New chat, or a quiet spell): the last one left its note
   * and tidy job, and the model starts fresh. The window clears the transcript.
   */
  | { type: "chat.started" }
  /**
   * One beat of a `draw` call (ticket 31): the line the voice says (`say`) and the
   * marks to draw while it is said, already checked (src/core/canvas.ts). `id` is
   * the call, `beat` counts from 0. Coordinates are on the 1000 x 600 board.
   * Marks stay on the canvas until a new chat (`chat.started`).
   */
  | { type: "canvas.beat"; id: string; beat: number; say: string; marks: Mark[] }
  /**
   * A mark changed (ticket 33, `edit_canvas`; `id` is the call): `change` is what
   * the model asked for, `mark` the whole mark after it (same mark id, already checked).
   */
  | { type: "canvas.edit"; id: string; change: MarkChange; mark: Mark }
  /**
   * The voice starts saying beat `beat` of draw call `id` (ticket 34): the model's
   * transcript reached the start of that beat's `say` line. Sent at most once per
   * beat, in order. A line never said (reworded, or a turn ended first) gets none.
   */
  | { type: "canvas.speak"; id: string; beat: number }
  /**
   * Marks erased by id (ticket 33). `all`: the board was cleared, and `ids` was everything on it.
   * An interruption also erases the beats not yet spoken (ticket 34), so the canvas keeps only what was said.
   */
  | { type: "canvas.erase"; id: string; ids: string[]; all: boolean }
  /**
   * The link to the model (ticket 40). `reconnecting`: no network, the core tries again in
   * `retryInMs` (it never gives up; the window shows "Reconnecting…"). `connected`: back.
   */
  | { type: "connection"; state: "reconnecting"; attempt: number; retryInMs: number; message: string }
  | { type: "connection"; state: "connected" }
  /**
   * Screen awareness: a screenshot went into the model. `look` = the model asked to see the
   * screen; `circle` = the user circled something while holding Ctrl+Option (`text` says where).
   * `map` turns the shot's pixels back into global screen points.
   */
  | { type: "screen.shot"; reason: "look" | "circle"; width: number; height: number; map: ShotMap; text?: string }
  /**
   * A permission Jett needs is off: Screen Recording (`kind` missing or "screen": Jett cannot
   * see) or Accessibility ("accessibility": real controls cannot be found by their words).
   * The window shows how to turn it on.
   */
  | { type: "screen.permission"; granted: boolean; message?: string; kind?: "screen" | "accessibility" }
  /**
   * The front app's window (global points), sent while a drawing is up and whenever it changes,
   * so cards keep off it. `front` null: no window (the desktop).
   */
  | { type: "screen.front"; front: FrontWindow | null }
  /**
   * What the locator read on the front window (words, controls; global points): where it is
   * busy. With a window that fills the screen, cards go where it is emptiest.
   */
  | { type: "screen.boxes"; boxes: Rect[]; front: FrontWindow | null }
  /** Screen marks went stale (the window moved, the app switched, a scroll or click): they are erased next. */
  | { type: "screen.stale"; ids: string[]; reason: string }
  /** The model finished its reply. `reply` is the whole reply, joined for you. */
  | { type: "turn.done"; reply: string }
  /** Something went wrong in the session. The session may still be usable. */
  | { type: "error"; message: string };

/** Pick one event type out of the union, e.g. `EventOf<"turn.done">`. */
export type EventOf<T extends AgentEvent["type"]> = Extract<AgentEvent, { type: T }>;
